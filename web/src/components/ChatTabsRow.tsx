// Chat tabs row at the top of a project workspace's content area. One
// entry per open chat. Visible chats are in ink color; minimized chats
// are dimmed but clickable (click to restore).
//
// Each tab carries a small × on hover to close the chat from the workspace
// (note: closing here is NOT the same as wrap-chat — wrap files a report
// and is a different per-pane action; this just removes the chat from the
// workspace UI).

import type { OpenChat } from "../types";
import { CHARACTER_NAMES } from "./characterNames";

interface Props {
  openChats: OpenChat[];
  onActivate: (chatId: string) => void;
  onClose: (chatId: string) => void;
}

export function ChatTabsRow({ openChats, onActivate, onClose }: Props) {
  if (openChats.length === 0) return null;

  return (
    <div className="shrink-0 flex items-stretch border-b border-divider bg-bg overflow-x-auto">
      {openChats.map((chat) => {
        const name = CHARACTER_NAMES[chat.employeeId];
        const labelText = chat.label?.trim() || "(no brief)";
        const isVisible = chat.visible;
        return (
          <div key={chat.chatId} className="group relative flex items-center shrink-0">
            <button
              onClick={() => onActivate(chat.chatId)}
              className={`relative max-w-[260px] pl-4 pr-2 py-2 transition-colors ${
                isVisible ? "" : "hover:bg-surface/40"
              }`}
              title={labelText}
            >
              {isVisible && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1.5 bottom-1.5 w-px bg-accent pointer-events-none"
                />
              )}
              <div className="flex items-baseline gap-2 min-w-0">
                <span
                  className={`font-display text-[13px] tracking-tight whitespace-nowrap ${
                    isVisible ? "text-ink" : "text-muted"
                  }`}
                >
                  {name}
                </span>
                <span
                  className={`text-[11px] truncate max-w-[180px] ${
                    isVisible ? "text-muted" : "text-muted/60"
                  }`}
                >
                  {truncate(labelText, 36)}
                </span>
              </div>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(chat.chatId);
              }}
              className="self-center px-2 text-[13px] text-muted hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={`Close chat with ${name}`}
              title="Close from workspace"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}
