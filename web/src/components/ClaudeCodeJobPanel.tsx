// Live + done panel for a Claude Code execution job.
//
// On mount: fetch /api/jobs/:id snapshot. If terminal, render the completed
// or failed state and skip subscribing. Otherwise, open the SSE stream and
// stream events into local state until completed/failed arrives.
//
// Three visual states, all framed the same way as CastSuggestion family:
//   - running   — header pulse + monospace running log + tool annotations
//   - completed — summary headline + diff stat + collapsible diff body
//   - failed    — error message + stage tag (workspace/execution/diff)

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { getJob, openJobStream } from "../lib/api";
import type {
  ExecutionJobSnapshot,
  JobDiff,
  JobFailure,
  JobStatus,
  StreamOutputKind,
} from "../types";

interface Props {
  jobId: string;
  summary: string;
  prompt: string;
}

interface OutputItem {
  id: string;
  kind: StreamOutputKind;
  payload: string;
}

interface PanelState {
  status: JobStatus | "loading";
  outputs: OutputItem[];
  diff: JobDiff | null;
  failure: JobFailure | null;
}

const INITIAL: PanelState = {
  status: "loading",
  outputs: [],
  diff: null,
  failure: null,
};

export function ClaudeCodeJobPanel({ jobId, summary, prompt }: Props) {
  const [state, setState] = useState<PanelState>(INITIAL);
  const [diffExpanded, setDiffExpanded] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setState(INITIAL);
    setDiffExpanded(false);
    let canceled = false;

    (async () => {
      // 1. Fetch snapshot to recover any current state.
      const snapshot = await getJob(jobId).catch(() => null);
      if (canceled || !mountedRef.current) return;
      if (snapshot) applySnapshot(snapshot);

      // If terminal, no need to open a stream.
      if (snapshot && (snapshot.status === "completed" || snapshot.status === "failed")) {
        return;
      }

      // 2. Open SSE for live events.
      cleanupRef.current = openJobStream(jobId, {
        onSubscribed: () => {
          // Move out of "loading" once subscribed if we don't have a snapshot.
          setState((s) =>
            s.status === "loading" ? { ...s, status: snapshot?.status ?? "queued" } : s,
          );
        },
        onOutput: (ev) => {
          if (!mountedRef.current) return;
          setState((s) => ({
            ...s,
            status: s.status === "loading" || s.status === "queued" ? "running" : s.status,
            outputs: [...s.outputs, { id: crypto.randomUUID(), ...ev }],
          }));
        },
        onCompleted: (ev) => {
          if (!mountedRef.current) return;
          setState((s) => ({
            ...s,
            status: "completed",
            diff: {
              summary: ev.summary,
              diffStat: ev.diffStat,
              diff: ev.diff,
              diffTruncated: ev.diffTruncated,
            },
          }));
        },
        onFailed: (ev) => {
          if (!mountedRef.current) return;
          setState((s) => ({
            ...s,
            status: "failed",
            failure: { error: ev.error, stage: ev.stage },
          }));
        },
        onError: () => {
          // On transport error, re-poll snapshot to see if job actually
          // finished (we might have lost the close event).
          if (!mountedRef.current) return;
          void (async () => {
            const snap = await getJob(jobId).catch(() => null);
            if (snap && mountedRef.current) applySnapshot(snap);
          })();
        },
        onClose: () => {
          // Same defensive re-fetch — if the server closed the stream after
          // a terminal event, our state is already terminal; if not, the
          // snapshot will tell us.
          if (!mountedRef.current) return;
          void (async () => {
            const snap = await getJob(jobId).catch(() => null);
            if (snap && mountedRef.current) applySnapshot(snap);
          })();
        },
      });
    })();

    return () => {
      canceled = true;
      mountedRef.current = false;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  function applySnapshot(snap: ExecutionJobSnapshot) {
    setState((s) => ({
      ...s,
      status: snap.status,
      diff: snap.diff,
      failure: snap.failure,
      // We don't reconstruct individual output events from the persisted
      // stream — the snapshot is for terminal states or recovery. If
      // running, the SSE will deliver live events; the panel will hydrate
      // from there.
      outputs: snap.status === "running" ? s.outputs : s.outputs,
    }));
  }

  // ── Render ─────────────────────────────────────────────────────────

  const { status, outputs, diff, failure } = state;
  const toolSummary = useMemo(() => summarizeToolActivity(outputs), [outputs]);
  const textOutput = useMemo(
    () => outputs.filter((o) => o.kind === "text").map((o) => o.payload).join(""),
    [outputs],
  );

  return (
    <motion.aside
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="my-5 border border-divider rounded-sm bg-surface/40 px-5 py-4 max-w-prose"
    >
      {/* Header */}
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted mb-1">
            Claude Code run
          </div>
          <div className="font-display text-xl text-ink leading-tight">{summary}</div>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Prompt — collapsible, always available */}
      <details
        className="mt-2"
        open={promptExpanded}
        onToggle={(e) => setPromptExpanded((e.target as HTMLDetailsElement).open)}
      >
        <summary className="text-[11px] text-muted cursor-pointer select-none hover:text-ink transition-colors">
          {promptExpanded ? "hide prompt" : "show prompt"}
        </summary>
        <pre className="mt-1 font-mono text-[12px] text-ink whitespace-pre-wrap leading-relaxed bg-bg/40 border border-divider/60 rounded-sm px-3 py-2 max-h-[200px] overflow-y-auto">
          {prompt}
        </pre>
      </details>

      {/* Body — varies by status */}
      {(status === "running" || status === "queued" || status === "loading") && (
        <RunningBody outputs={outputs} textOutput={textOutput} status={status} />
      )}

      {status === "completed" && (
        <CompletedBody
          diff={diff}
          diffExpanded={diffExpanded}
          onToggleDiff={() => setDiffExpanded((v) => !v)}
          toolSummary={toolSummary}
        />
      )}

      {status === "failed" && <FailedBody failure={failure} />}
    </motion.aside>
  );
}

// ── Status badge ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PanelState["status"] }) {
  if (status === "running" || status === "loading" || status === "queued") {
    return (
      <span className="text-[11px] text-muted ink-pulse uppercase tracking-[0.12em]">
        {status === "queued" ? "queued" : "running"}
      </span>
    );
  }
  if (status === "completed") {
    return <span className="text-[11px] text-accent uppercase tracking-[0.12em]">done</span>;
  }
  return <span className="text-[11px] text-muted uppercase tracking-[0.12em]">failed</span>;
}

// ── Running body ───────────────────────────────────────────────────────

function RunningBody({
  outputs,
  textOutput,
  status,
}: {
  outputs: OutputItem[];
  textOutput: string;
  status: PanelState["status"];
}) {
  const annotations = outputs.filter((o) => o.kind !== "text");
  const showWaiting = outputs.length === 0;

  return (
    <div className="mt-3">
      {showWaiting && (
        <div className="text-[12px] text-muted italic">
          {status === "queued"
            ? "agent is offline — this run will start when the agent reconnects"
            : "agent is starting…"}
        </div>
      )}

      {textOutput && (
        <pre className="font-mono text-[12px] text-ink whitespace-pre-wrap leading-relaxed bg-bg/40 border border-divider/60 rounded-sm px-3 py-2 mt-1 max-h-[320px] overflow-y-auto">
          {textOutput}
        </pre>
      )}

      {annotations.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {annotations.map((a) => (
            <li key={a.id} className="font-mono text-[11px] text-muted pl-1">
              {renderAnnotation(a)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function renderAnnotation(item: OutputItem): string {
  if (item.kind === "tool_use") {
    try {
      const obj = JSON.parse(item.payload) as { name?: string; input?: { file_path?: string; path?: string; command?: string } };
      const target = obj.input?.file_path ?? obj.input?.path ?? obj.input?.command;
      return `▸ ${obj.name ?? "tool"}${target ? `: ${truncate(String(target), 80)}` : ""}`;
    } catch {
      return `▸ tool: ${truncate(item.payload, 80)}`;
    }
  }
  if (item.kind === "tool_result") {
    try {
      const obj = JSON.parse(item.payload) as { content?: unknown };
      const txt = typeof obj.content === "string" ? obj.content : JSON.stringify(obj.content ?? "");
      return `  ↳ ${truncate(txt, 80)}`;
    } catch {
      return `  ↳ ${truncate(item.payload, 80)}`;
    }
  }
  return `▸ ${truncate(item.payload, 80)}`;
}

function truncate(s: string, n: number): string {
  const trimmed = s.replace(/\s+/g, " ").trim();
  return trimmed.length > n ? trimmed.slice(0, n - 1) + "…" : trimmed;
}

// ── Completed body ─────────────────────────────────────────────────────

function CompletedBody({
  diff,
  diffExpanded,
  onToggleDiff,
  toolSummary,
}: {
  diff: JobDiff | null;
  diffExpanded: boolean;
  onToggleDiff: () => void;
  toolSummary: string | null;
}) {
  if (!diff) {
    return (
      <div className="mt-3 text-[13px] text-muted italic">Done. (no result captured)</div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {diff.summary && (
        <p className="text-[14px] text-ink leading-relaxed">{diff.summary}</p>
      )}
      {toolSummary && (
        <div className="font-mono text-[11px] text-muted">{toolSummary}</div>
      )}
      {diff.diffStat && (
        <pre className="font-mono text-[12px] text-ink whitespace-pre-wrap leading-relaxed bg-bg/40 border border-divider/60 rounded-sm px-3 py-2">
          {diff.diffStat.trim()}
        </pre>
      )}
      {diff.diff && (
        <div>
          <button
            onClick={onToggleDiff}
            className="text-[12px] text-muted hover:text-ink transition-colors"
          >
            {diffExpanded ? "hide diff" : "show diff"}
            {diff.diffTruncated && diffExpanded ? " (truncated)" : ""}
          </button>
          {diffExpanded && (
            <pre className="mt-1 font-mono text-[12px] text-ink whitespace-pre leading-relaxed bg-bg/40 border border-divider/60 rounded-sm px-3 py-2 max-h-[420px] overflow-auto">
              {diff.diff}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function summarizeToolActivity(outputs: OutputItem[]): string | null {
  const counts: Record<string, number> = {};
  for (const o of outputs) {
    if (o.kind !== "tool_use") continue;
    try {
      const obj = JSON.parse(o.payload) as { name?: string };
      const name = obj.name ?? "tool";
      counts[name] = (counts[name] ?? 0) + 1;
    } catch {
      counts["tool"] = (counts["tool"] ?? 0) + 1;
    }
  }
  const parts = Object.entries(counts).map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`);
  if (parts.length === 0) return null;
  return `▸ ${parts.join(", ")}`;
}

// ── Failed body ────────────────────────────────────────────────────────

function FailedBody({ failure }: { failure: JobFailure | null }) {
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-baseline gap-3">
        {failure?.stage && (
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted">
            {failure.stage}
          </span>
        )}
      </div>
      <p className="text-[13px] text-muted leading-relaxed">
        {failure?.error ?? "Worker reported a failure without a message."}
      </p>
    </div>
  );
}
