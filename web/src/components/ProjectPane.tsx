// A single project pane in the workspace grid. v2: each pane is one
// project's manager chat. The pane header carries the project name and
// minimize/close buttons; the body is the manager's ChatView.
//
// The pane is responsible for resolving (or fetching) the manager chatId
// for its project. We store the chatId in workspace state so a reload
// doesn't need to round-trip again. The "resolving" state is brief —
// shown once on first open of a project; subsequent renders use the cached
// id immediately.

import { useEffect, useState } from "react";
import { resolveManagerChat } from "../lib/api";
import { useStore } from "../state/store";
import { ChatView } from "./ChatView";
import type { ProjectListItem } from "../types";

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
  const project: ProjectListItem | undefined = state.projects.find(
    (p) => p.id === projectId,
  );
  const chatId = workspace?.managerChatId ?? null;

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

  const projectName = project?.name ?? "(loading…)";
  const isActive = state.activeWorkspaceId === workspace?.id;

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
          {projectName}
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
              // If this pane isn't currently active, flag unread on its
              // (possibly-minimized) workspace.
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
