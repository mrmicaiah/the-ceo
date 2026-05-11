// A single chat pane inside the chat grid. Wraps ChatView with a header
// strip containing the employee name and (hover-reveal) minimize/close
// buttons + a compact Wrap affordance. The pane is the boundary that
// translates per-chat actions (minimize, close, wrap) back to the workspace.

import { useState } from "react";
import { ChatView } from "./ChatView";
import { WrapChatButton } from "./WrapChatButton";
import { CHARACTER_NAMES } from "./characterNames";
import type { Briefing, EmployeeId, WorkspaceId } from "../types";

interface Props {
  workspaceId: WorkspaceId;
  projectId: string;
  chatId: string;
  employeeId: EmployeeId;
  onMinimize: () => void;
  onClose: () => void;
  onInteraction: () => void;
  onBriefingUpdate: (briefing: Briefing | null) => void;
  /** Layout helpers — applied as Tailwind classes by ChatGrid. */
  className?: string;
}

export function ChatPane({
  workspaceId: _workspaceId,
  projectId,
  chatId,
  employeeId,
  onMinimize,
  onClose,
  onInteraction,
  onBriefingUpdate,
  className,
}: Props) {
  const [wrapped, setWrapped] = useState(false);
  const employeeName = CHARACTER_NAMES[employeeId];

  return (
    <div
      className={`flex flex-col min-w-0 min-h-0 overflow-hidden ${className ?? ""}`}
      onMouseDownCapture={onInteraction}
    >
      {/* Header strip */}
      <div className="group shrink-0 flex items-center justify-between px-6 pt-4 pb-2 border-b border-divider">
        <div className="font-display text-[15px] text-ink tracking-tight">
          {employeeName}
        </div>
        <div className="flex items-center gap-3">
          {!wrapped && (
            <WrapChatButton
              chatId={chatId}
              employeeName={employeeName}
              projectName={null}
              compact
              onWrapped={(briefing) => {
                setWrapped(true);
                onBriefingUpdate(briefing);
              }}
            />
          )}
          <button
            onClick={onMinimize}
            className="text-[14px] text-muted hover:text-ink opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity leading-none px-1"
            aria-label="Minimize chat"
            title="Minimize"
          >
            —
          </button>
          <button
            onClick={onClose}
            className="text-[14px] text-muted hover:text-ink opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity leading-none px-1"
            aria-label="Close chat from workspace"
            title="Close from workspace"
          >
            ×
          </button>
        </div>
      </div>

      {/* The chat itself */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatView
          kind="employee"
          chatId={chatId}
          projectId={projectId}
          hideHeader
          onInteraction={onInteraction}
          onWrapped={(briefing) => {
            setWrapped(true);
            onBriefingUpdate(briefing);
          }}
        />
      </div>
    </div>
  );
}
