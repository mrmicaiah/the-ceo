// Inline affordance for staff-to-staff handoffs.
//
// Visual family matches CastSuggestion + DispatchClaudeCodeSuggestion:
// 1px hairline border, surface/40 fill, lightly rounded. Display-type
// name + role tag on the right; a small "From <X> →" framing line in
// italic muted; the brief in a framed sub-area with a "show full brief"
// toggle past ~10 lines / 500 chars; one accent-color action link at
// the bottom.
//
// On click: POST /api/projects/:projectId/handoff, then openWorkspace +
// openChat + switchWorkspace via the run-#7 store. The originating chat
// stays visible; the new colleague's pane appears beside it (or auto-
// minimizes another via enforceVisibleCap if 4 are already up).
//
// Sent state persists per (sourceChatId, toEmployee, brief-hash) so reload
// shows "sent to Dex." rather than re-offering. Clicking the sent affordance
// switches to that workspace and restores the chat if minimized — a quick
// way to jump back to the handed-off conversation.

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { handoffToColleague } from "../lib/api";
import { getHandoffSent, rememberHandoffSent } from "../lib/storage";
import { useStore } from "../state/store";
import { CHARACTER_NAMES, CHARACTER_ROLES } from "./characterNames";
import { workspaceIdForProject, type EmployeeId } from "../types";

interface Props {
  fromEmployee: EmployeeId | null; // null when context can't supply (e.g., CEO chat)
  toEmployee: EmployeeId;
  project: string;
  brief: string;
  sourceChatId: string;
}

export function HandoffSuggestion({
  fromEmployee,
  toEmployee,
  project,
  brief,
  sourceChatId,
}: Props) {
  const { openWorkspace, openChat, switchWorkspace, restoreChat, state } = useStore();

  // Persisted sent state — keyed by source chat + recipient + brief hash.
  const [newChatId, setNewChatId] = useState<string | null>(() =>
    getHandoffSent(sourceChatId, toEmployee, brief),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-check storage on content change — covers the case where the same
  // block re-renders after a remount but storage was written elsewhere.
  useEffect(() => {
    const existing = getHandoffSent(sourceChatId, toEmployee, brief);
    if (existing && existing !== newChatId) setNewChatId(existing);
  }, [sourceChatId, toEmployee, brief, newChatId]);

  // Self-handoff guard at the UI layer. The server also rejects this with
  // 400, but if we know up-front, skip the dispatch and render a disabled
  // note instead of an actionable link.
  const isSelfHandoff = fromEmployee !== null && fromEmployee === toEmployee;

  const onSend = async () => {
    if (pending || isSelfHandoff || !fromEmployee) return;
    setPending(true);
    setError(null);
    try {
      const result = await handoffToColleague({
        projectId: project,
        fromEmployee,
        toEmployee,
        brief,
        sourceChatId,
      });
      rememberHandoffSent(sourceChatId, toEmployee, brief, result.chatId);
      setNewChatId(result.chatId);

      // Open the project workspace (no-op if already open), add the new
      // chat, and switch. Originating chat stays in the workspace; the new
      // colleague's pane appears beside it.
      openWorkspace(result.projectId, /* activate */ true);
      const workspaceId = workspaceIdForProject(result.projectId);
      openChat({
        workspaceId,
        chatId: result.chatId,
        employeeId: result.employee,
        label: deriveLabelFromBrief(brief),
      });
      switchWorkspace(workspaceId);
    } catch (e) {
      setError((e as Error).message);
      setPending(false);
    }
  };

  // Already-sent state: a compact "sent to <colleague>" line, clickable to
  // jump to the resulting chat. No border, no fill — mirrors the post-action
  // note style other affordances morph to.
  if (newChatId) {
    const onFocus = () => {
      // Find the workspace containing this chat and switch + restore.
      const wsId = workspaceIdForProject(project);
      const ws = state.workspaces.find((w) => w.id === wsId);
      // Open if missing (e.g., closed by user since handoff).
      openWorkspace(project, /* activate */ true);
      if (ws?.openChats.some((c) => c.chatId === newChatId && !c.visible)) {
        restoreChat(wsId, newChatId);
      } else if (!ws?.openChats.some((c) => c.chatId === newChatId)) {
        // Chat exists in DB but not in workspace's openChats (e.g. closed
        // from workspace earlier). Re-add it.
        openChat({
          workspaceId: wsId,
          chatId: newChatId,
          employeeId: toEmployee,
          label: deriveLabelFromBrief(brief),
        });
      }
      switchWorkspace(wsId);
    };
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="my-5 max-w-prose text-[13px] text-muted italic leading-relaxed"
      >
        Sent to {CHARACTER_NAMES[toEmployee]}.{" "}
        <button
          onClick={onFocus}
          className="not-italic text-[12px] text-accent hover:underline underline-offset-2"
        >
          open chat →
        </button>
      </motion.div>
    );
  }

  return (
    <motion.aside
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="my-5 border border-divider rounded-sm bg-surface/40 px-5 py-4 max-w-prose"
    >
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted mb-2">
        Suggested handoff
      </div>
      <div className="flex items-baseline gap-3">
        <div className="font-display text-xl text-ink leading-tight">
          {CHARACTER_NAMES[toEmployee]}
        </div>
        <div className="text-[12px] text-muted">{CHARACTER_ROLES[toEmployee]}</div>
      </div>
      {fromEmployee && (
        <div className="mt-1 text-[12px] text-muted italic">
          From {CHARACTER_NAMES[fromEmployee]} →
        </div>
      )}
      <BriefPreview brief={brief} />

      <div className="mt-3 flex items-center gap-4">
        {isSelfHandoff ? (
          <span className="text-[12px] text-muted italic">
            Self-handoff blocked — pick a different colleague.
          </span>
        ) : !fromEmployee ? (
          <span className="text-[12px] text-muted italic">
            Can't send: source employee not available from this chat context.
          </span>
        ) : (
          <button
            onClick={onSend}
            disabled={pending}
            className="text-[13px] text-accent disabled:opacity-50 hover:underline underline-offset-2"
          >
            {pending ? "sending…" : `Send to ${CHARACTER_NAMES[toEmployee]} →`}
          </button>
        )}
        {error && <span className="text-[12px] text-muted">{error}</span>}
      </div>
    </motion.aside>
  );
}

/**
 * Show the first ~10 lines of the brief; reveal the rest behind a "show full
 * brief" toggle. Threshold matches the spec (10 lines or 500 chars).
 * Visual treatment mirrors PromptPreview in DispatchClaudeCodeSuggestion —
 * but the brief is conversational prose, not a Claude Code prompt, so we
 * render it with prose styles, not monospace.
 */
function BriefPreview({ brief }: { brief: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = brief.split("\n");
  const isLong = lines.length > 10 || brief.length > 500;
  const preview =
    expanded || !isLong
      ? brief
      : lines.slice(0, 10).join("\n") + (lines.length > 10 ? "\n…" : "");

  return (
    <div className="mt-3">
      <div className="text-[14px] text-ink whitespace-pre-wrap leading-relaxed border-t border-divider/60 pt-3">
        {preview}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] text-muted hover:text-ink transition-colors"
        >
          {expanded ? "collapse brief" : "show full brief"}
        </button>
      )}
    </div>
  );
}

/**
 * Brief → short label for the chat-tab strip. First line, trimmed, capped.
 * If the first line is too short to be useful, fall back to a generic label.
 */
function deriveLabelFromBrief(brief: string): string {
  const firstLine = brief.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  if (firstLine.length === 0) return "Handoff";
  return firstLine.length > 120 ? firstLine.slice(0, 117) + "…" : firstLine;
}
