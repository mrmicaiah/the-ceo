// The central chat view. Renders the message transcript and the composer.
// Owns the per-chat message state (fetched on mount). Streams responses.
//
// Run #7 refactor: ChatView no longer fetches briefings or touches global
// store. The Workspace that owns this chat fetches the project briefing
// once; ChatView reports wrap results back via the onWrapped callback.
//
// Props split into two shapes:
//   - kind="ceo" — used inside the CEO workspace; renders no header (the
//     workspace chrome provides whatever it needs).
//   - kind="employee" — used inside a ChatPane in a project workspace. The
//     pane provides its own header + wrap; ChatView hides its internal
//     header when hideHeader=true.

import { useCallback, useEffect, useRef, useState } from "react";
import { getChat, sendCeoMessage, sendEmployeeMessage } from "../lib/api";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { WrapChatButton } from "./WrapChatButton";
import { CHARACTER_NAMES } from "./characterNames";
import type { ChatMessage, EmployeeId, Briefing } from "../types";

type Props =
  | { kind: "ceo"; chatId: string }
  | {
      kind: "employee";
      chatId: string;
      projectId: string;
      hideHeader?: boolean;
      // Called when wrap-chat completes successfully — passes the updated
      // briefing up to the workspace so the rail can refresh.
      onWrapped?: (briefing: Briefing | null) => void;
      // Called when the user interacts with this pane (focus composer,
      // send, click) so the workspace can bump lastInteractionAt for LRU.
      onInteraction?: () => void;
    };

export function ChatView(props: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingAssistant, setStreamingAssistant] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<EmployeeId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatWrapped, setChatWrapped] = useState(false);
  const inflight = useRef<AbortController | null>(null);

  // Initial load — fetch existing chat metadata + history if any.
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const chat = await getChat(props.chatId);
        if (canceled) return;
        if (chat) {
          setMessages(chat.messages);
          if (chat.employeeId) setEmployeeId(chat.employeeId);
          if (chat.status === "wrapped") setChatWrapped(true);
        }
      } catch {
        // 404 / no chat yet — fine for new conversations.
      }
    })();

    return () => {
      canceled = true;
      inflight.current?.abort();
    };
  }, [props.chatId]);

  const isStreaming = streamingAssistant !== null;

  const touch = useCallback(() => {
    if (props.kind === "employee" && props.onInteraction) {
      props.onInteraction();
    }
  }, [props]);

  const onSend = useCallback(
    async (text: string) => {
      if (isStreaming || chatWrapped) return;
      setError(null);
      touch();

      const userMsg: ChatMessage = {
        id: `local-user-${Date.now()}`,
        chatId: props.chatId,
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setStreamingAssistant("");

      const ctrl = new AbortController();
      inflight.current = ctrl;
      let assistantBuffer = "";

      const handlers = {
        onChunk: (delta: string) => {
          assistantBuffer += delta;
          setStreamingAssistant(assistantBuffer);
        },
        onDone: () => {
          if (assistantBuffer.length > 0) {
            setMessages((prev) => [
              ...prev,
              {
                id: `local-assistant-${Date.now()}`,
                chatId: props.chatId,
                role: "assistant",
                content: assistantBuffer,
                createdAt: new Date().toISOString(),
              },
            ]);
          }
          setStreamingAssistant(null);
          inflight.current = null;
        },
        onError: (msg: string) => {
          setError(msg);
        },
      };

      try {
        if (props.kind === "ceo") {
          await sendCeoMessage(
            { chatId: props.chatId, message: text },
            handlers,
            ctrl.signal,
          );
        } else {
          const empId = employeeId ?? "dex";
          await sendEmployeeMessage(
            {
              employee: empId,
              chatId: props.chatId,
              message: text,
              projectId: props.projectId,
            },
            handlers,
            ctrl.signal,
          );
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
          setStreamingAssistant(null);
        }
      }
    },
    [isStreaming, chatWrapped, props, employeeId, touch],
  );

  // Computed labels — only used for the legacy in-component header (CEO
  // workspace doesn't render one anyway; project workspaces use the pane
  // wrapper's header).
  const employeeName = employeeId ? CHARACTER_NAMES[employeeId] : null;
  const showLegacyHeader =
    props.kind === "employee" &&
    props.hideHeader !== true; // explicit opt-in for the pane wrapper

  const projectId = props.kind === "employee" ? props.projectId : null;
  const onWrappedCallback = props.kind === "employee" ? props.onWrapped : undefined;

  return (
    <div className="h-full flex flex-col" onMouseDownCapture={touch}>
      {showLegacyHeader && (
        <div className="px-10 pt-6 pb-3 flex items-center justify-between border-b border-divider">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted">
              {employeeName ?? "Employee"} chat
            </div>
          </div>
          {!chatWrapped && messages.length > 0 && (
            <WrapChatButton
              chatId={props.chatId}
              employeeName={employeeName}
              projectName={null}
              onWrapped={(briefing) => {
                setChatWrapped(true);
                onWrappedCallback?.(briefing);
              }}
            />
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <MessageList
          messages={messages}
          streamingAssistant={streamingAssistant}
          sourceChatId={props.chatId}
          kind={props.kind}
          employeeId={employeeId}
        />
      </div>

      {error && (
        <div className="px-10 py-2 text-[12px] text-muted border-t border-divider">
          {error}
        </div>
      )}

      <div className="border-t border-divider px-10 py-5" onMouseDown={touch}>
        <Composer onSend={onSend} disabled={isStreaming || chatWrapped} />
        {chatWrapped && (
          <div className="mt-2 text-[12px] text-muted italic">This chat is wrapped.</div>
        )}
      </div>

      {/* Expose wrap state via a hidden marker so pane wrappers can show
          "wrapped" UI if they want. The pane wrapper has its own knowledge
          of the chat via the chat record; this is only here for the legacy
          standalone path. */}
      {/* Keep ts happy: reference projectId to avoid unused warnings. */}
      <span className="hidden" aria-hidden>
        {projectId}
      </span>
    </div>
  );
}
