// Grid of visible chat panes. Layout adapts by count:
//   1 → single pane fills the area
//   2 → side-by-side, 50/50
//   3 → 2 on top + 1 full-width on bottom (Option A from the spec)
//   4 → 2x2
//
// Implemented with CSS grid so panes flex to viewport. Hairline dividers
// applied as borders on panes (right + bottom where appropriate).

import { ChatPane } from "./ChatPane";
import type { Briefing, OpenChat, WorkspaceId } from "../types";

interface Props {
  workspaceId: WorkspaceId;
  projectId: string;
  visibleChats: OpenChat[];
  onMinimize: (chatId: string) => void;
  onClose: (chatId: string) => void;
  onTouch: (chatId: string) => void;
  onBriefingUpdate: (briefing: Briefing | null) => void;
}

export function ChatGrid({
  workspaceId,
  projectId,
  visibleChats,
  onMinimize,
  onClose,
  onTouch,
  onBriefingUpdate,
}: Props) {
  const n = visibleChats.length;
  if (n === 0) return null;

  const containerClass =
    n === 1
      ? "grid-cols-1 grid-rows-1"
      : n === 2
        ? "grid-cols-2 grid-rows-1"
        : "grid-cols-2 grid-rows-2";

  return (
    <div className={`flex-1 grid min-h-0 ${containerClass}`}>
      {visibleChats.map((chat, idx) => {
        // For the 3-chat case, the 3rd pane spans both columns (full bottom row).
        const spansFull = n === 3 && idx === 2;

        // Right border on left-column panes when the row has 2 items.
        const isLeftCol = idx % 2 === 0;
        const hasNeighborRight =
          !spansFull && isLeftCol && idx + 1 < n && !(n === 3 && idx + 1 === 2);

        // Bottom border on top-row panes when there's a row below.
        const isTopRow = n > 2 && idx < 2;

        const classNames = [
          spansFull ? "col-span-2" : "",
          hasNeighborRight ? "border-r border-divider" : "",
          isTopRow ? "border-b border-divider" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <ChatPane
            key={chat.chatId}
            workspaceId={workspaceId}
            projectId={projectId}
            chatId={chat.chatId}
            employeeId={chat.employeeId}
            onMinimize={() => onMinimize(chat.chatId)}
            onClose={() => onClose(chat.chatId)}
            onInteraction={() => onTouch(chat.chatId)}
            onBriefingUpdate={onBriefingUpdate}
            className={classNames}
          />
        );
      })}
    </div>
  );
}
