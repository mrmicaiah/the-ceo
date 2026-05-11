// The central chat view. Renders the message transcript and the composer.
// Owns the per-chat message state (fetched on mount). Streams responses.
// For project chats, also owns the wrap affordance and pushes the resulting
// updated briefing into global state so the right rail can animate.

import { useCallback, useEffect, useRef, useState } from "react";
import { getBriefing, getChat, sendCeoMessage, sendEmployeeMessage } from "../lib/api";
import { useStore } from "../state/store";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { WrapChatButton } from "./WrapChatButton";
import { CHARACTER_NAMES } from "./characterNames";
import type { ChatMessage, EmployeeId } from "../types";

type Props =
  | { kind: "ceo"; chatId: string }
  | { kind: "employee"; chatId: string; projectId: string };

export function ChatView(props: Props) {
  const { setBriefing, refreshProjects } = useStore();
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
        // 404 / no chat yet — fine for new conversations. Surface only real errors.
      }
    })();

    return () => {
      canceled = true;
      inflight.current?.abort();
    };
  }, [props.chatId]);

  // Load the briefing into global state for the right rail.
  useEffect(() => {
    if (props.kind !== "employee") {
      setBriefing(null, null);
      return;
    }
    let canceled = false;
    (async () => {
      try {
        const briefing = await getBriefing(props.projectId);
        if (!canceled) setBriefing(briefing, props.projectId);
      } catch (err) {
        if (!canceled) setBriefing(null, null);
        if (!canceled) setError((err as Error).message);
      }
    })();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.kind, props.kind === "employee" ? props.projectId : null]);

  const isStreaming = streamingAssistant !== null;

  const onSend = useCallback(
    async (text: string) => {
      if (isStreaming || chatWrapped) return;
      setError(null);

      // Optimistically append the user message and open a placeholder for
      // the assistant. The server will assign real ids on persist; we use
      // ephemeral ones in the meantime.
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
          // Commit the streamed assistant message to the messages list and
          // clear the streaming buffer.
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
          await sendCeoMessage({ chatId: props.chatId, message: text }, handlers, ctrl.signal);
          // After a CEO message, refresh the projects list — the CEO may have
          // referenced a project we haven't loaded yet, or a new ping may have
          // moved the order. Cheap call.
          refreshProjects();
        } else {
          // Default to a known employee. The chat row created via /cast has
          // the employeeId set; we discovered it on mount. If unknown, default
          // to dex (won't happen in normal flow but defensive).
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
    [
      isStreaming,
      chatWrapped,
      props,
      employeeId,
      refreshProjects,
    ],
  );

  // Heading text for the chat. For project chats, show the project + employee.
  const employeeName = employeeId ? CHARACTER_NAMES[employeeId] : null;

  return (
    <div className="h-full flex flex-col">
      {props.kind === "employee" && (
        <div className="px-10 pt-6 pb-3 flex items-center justify-between border-b border-divider">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted">
              {employeeName ?? "Employee"} chat
            </div>
          </div>
          {!chatWrapped && messages.length > 0 && (
            <WrapChatButton
              chatId={props.chatId}
              onWrapped={(briefing) => {
                setChatWrapped(true);
                if (briefing && props.kind === "employee") {
                  setBriefing(briefing, props.projectId);
                }
                refreshProjects();
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

      <div className="border-t border-divider px-10 py-5">
        <Composer
          onSend={onSend}
          disabled={isStreaming || chatWrapped}
        />
        {chatWrapped && (
          <div className="mt-2 text-[12px] text-muted italic">
            This chat is wrapped.
          </div>
        )}
      </div>
    </div>
  );
}
