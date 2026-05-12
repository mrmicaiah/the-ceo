// A single project pane in the workspace grid. v3: each pane is one
// project's manager chat. The pane header carries the repo full-name
// (denormalized into workspace state at claim time) and minimize/close
// buttons; the body is the manager's ChatView.
//
// On mount, if `managerChatId` isn't yet cached in workspace state, the
// pane resolves the canonical manager chat via the API and caches it.

import { useEffect, useState } from "react";
import { resolveManagerChat } from "../lib/api";
import { useStore } from "../state/store";
import { ChatView } from "./ChatView";

interface Props {
  projectId: string;
  /** Layout helpers — applied as Tailwind classes by ChatGrid. */
  className?: string;
}

export function ProjectPane({ projectId, className }: Props) {
  const {
    state,
    minimizeProject,
    closeProject,
    setManagerChatId,
    touchProject,
    markUnread,
  } = useStore();

  const workspace = state.workspaces.find((w) => w.projectId === projectId);
  const chatId = workspace?.managerChatId ?? null;
  const repoFullName = workspace?.repoFullName ?? "(loading…)";
  const isActive = state.activeWorkspaceId === workspace?.id;

  const [resolving, setResolving] = useState<string | null>(null);
  useEffect(() => {
    if (chatId) return;
    let canceled = false;
    setResolving(null);
    (async () => {
      try {
        const result = await resolveManagerChat(projectId);
        if (canceled) return;
        setManagerChatId(projectId, result.chatId);
      } catch (err) {
        if (!canceled) setResolving((err as Error).message);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [chatId, projectId, setManagerChatId]);

  return (
    <div
      className={`flex flex-col min-w-0 min-h-0 overflow-hidden bg-bg ${className ?? ""}`}
      onMouseDownCapture={() => touchProject(projectId)}
    >
      {/* Header strip */}
      <div className="group shrink-0 flex items-center justify-between px-6 pt-4 pb-2 border-b border-divider relative">
        {isActive && (
          <span
            aria-hidden
            className="absolute left-0 top-2 bottom-2 w-px bg-accent pointer-events-none"
          />
        )}
        <div className="font-display text-[15px] text-ink tracking-tight truncate">
          {repoFullName}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => minimizeProject(projectId)}
            className="text-[14px] text-muted hover:text-ink opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity leading-none px-1"
            aria-label="Minimize project"
            title="Minimize"
          >
            —
          </button>
          <button
            onClick={() => closeProject(projectId)}
            className="text-[14px] text-muted hover:text-ink opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity leading-none px-1"
            aria-label="Close project"
            title="Close"
          >
            ×
          </button>
        </div>
      </div>

      {/* The manager chat itself */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {chatId ? (
          <ChatView
            projectId={projectId}
            chatId={chatId}
            onInteraction={() => touchProject(projectId)}
            onActivity={() => {
              if (!isActive) markUnread(projectId);
            }}
          />
        ) : (
          <PaneEmpty resolving={resolving} />
        )}
      </div>
    </div>
  );
}

function PaneEmpty({ resolving }: { resolving: string | null }) {
  return (
    <div className="h-full flex items-center justify-center px-10">
      <div className="max-w-[420px] text-center">
        {resolving ? (
          <div className="text-[12px] text-muted">{resolving}</div>
        ) : (
          <div className="text-[12px] text-muted italic editorial-shimmer">
            opening manager chat
          </div>
        )}
      </div>
    </div>
  );
}
