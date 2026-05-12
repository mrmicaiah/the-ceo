// Inline affordance for the manager's dispatch_claude_code block.
//
// Two states: idle (the "Suggested Claude Code run" card with the prompt
// preview and a "Run Claude Code →" link) and live (mounts ClaudeCodeJobPanel,
// which handles running/completed/failed). The morph is one-way: once the
// user clicks, we have a jobId and the card is replaced by the panel.
//
// jobId persistence: localStorage keyed by (chatId, summary, prompt) so that
// reload-after-dispatch shows the panel rather than the idle card.

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { dispatchClaudeCode } from "../lib/api";
import { getDispatchedJobId, rememberDispatchedJobId } from "../lib/storage";
import { ClaudeCodeJobPanel } from "./ClaudeCodeJobPanel";

interface Props {
  project: string;
  summary: string;
  prompt: string;
  sourceChatId: string;
}

export function DispatchClaudeCodeSuggestion({
  project,
  summary,
  prompt,
  sourceChatId,
}: Props) {
  // On mount, see if we already have a dispatched job for this content.
  const [jobId, setJobId] = useState<string | null>(() =>
    getDispatchedJobId(sourceChatId, summary, prompt),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-check localStorage when content changes (e.g., the chat re-renders
  // with the same action block). Safe because the lookup is by content hash.
  useEffect(() => {
    const existing = getDispatchedJobId(sourceChatId, summary, prompt);
    if (existing && existing !== jobId) setJobId(existing);
  }, [sourceChatId, summary, prompt, jobId]);

  if (jobId) {
    return <ClaudeCodeJobPanel jobId={jobId} summary={summary} prompt={prompt} />;
  }

  const onClick = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await dispatchClaudeCode({
        projectId: project,
        chatId: sourceChatId,
        summary,
        prompt,
      });
      rememberDispatchedJobId(sourceChatId, summary, prompt, result.jobId);
      setJobId(result.jobId);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  };

  return (
    <motion.aside
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="my-5 border border-divider rounded-sm bg-surface/40 px-5 py-4 max-w-prose"
    >
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted mb-2">
        Suggested Claude Code run
      </div>
      <div className="font-display text-xl text-ink leading-tight">{summary}</div>
      <PromptPreview prompt={prompt} />
      <div className="mt-3 flex items-center gap-4">
        <button
          onClick={onClick}
          disabled={pending}
          className="text-[13px] text-accent disabled:opacity-50 hover:underline underline-offset-2"
        >
          {pending ? "dispatching…" : "Run Claude Code →"}
        </button>
        {error && <span className="text-[12px] text-muted">{error}</span>}
      </div>
    </motion.aside>
  );
}

function PromptPreview({ prompt }: { prompt: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = prompt.split("\n");
  const isLong = lines.length > 6 || prompt.length > 320;
  const preview = expanded || !isLong
    ? prompt
    : lines.slice(0, 6).join("\n") + (lines.length > 6 ? "\n…" : "");

  return (
    <div className="mt-2">
      <pre className="font-mono text-[12px] text-ink whitespace-pre-wrap leading-relaxed bg-bg/40 border border-divider/60 rounded-sm px-3 py-2 max-h-[260px] overflow-y-auto">
        {preview}
      </pre>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] text-muted hover:text-ink transition-colors"
        >
          {expanded ? "collapse prompt" : "show full prompt"}
        </button>
      )}
    </div>
  );
}
