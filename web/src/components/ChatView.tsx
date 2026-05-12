// The manager's chat for one project. v2: one chat per project; no
// per-employee identity. ChatView owns its own message state, fetches the
// existing history once on mount, and streams responses through
// sendManagerMessage.

import { useCallback, useEffect, useRef, useState } from "react";
import { getChat, sendManagerMessage } from "../lib/api";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import type { ChatMessage } from "../types";

interface Props {
  projectId: string;
  chatId: string;
  // Called when the user sends or interacts — lets the workspace bump its
  // lastInteractionAt for LRU. Optional.
  onInteraction?: () => void;
  // Called when streaming activity occurs — lets a minimized workspace
  // raise its hasUnread flag. Optional.
  onActivity?: () => void;
}

export function ChatView({ projectId, chatId, onInteraction, onActivity }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingAssistant, setStreamingAssistant] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

  // Initial load — fetch existing message history if any.
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const chat = await getChat(chatId);
        if (canceled) return;
        if (chat) setMessages(chat.messages);
      } catch {
        // 404 / no chat yet — fine; the row will be created on first send.
      }
    })();
    return () => {
      canceled = true;
      inflight.current?.abort();
    };
  }, [chatId]);

  const isStreaming = streamingAssistant !== null;

  const touch = useCallback(() => {
    onInteraction?.();
  }, [onInteraction]);

  const onSend = useCallback(
    async (text: string) => {
      if (isStreaming) return;
      setError(null);
      touch();

      const userMsg: ChatMessage = {
        id: `local-user-${Date.now()}`,
        chatId,
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
          onActivity?.();
        },
        onDone: () => {
          if (assistantBuffer.length > 0) {
            setMessages((prev) => [
              ...prev,
              {
                id: `local-assistant-${Date.now()}`,
                chatId,
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
        await sendManagerMessage(
          { projectId, chatId, message: text },
          handlers,
          ctrl.signal,
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
          setStreamingAssistant(null);
        }
      }
    },
    [isStreaming, projectId, chatId, touch, onActivity],
  );

  return (
    <div className="h-full flex flex-col" onMouseDownCapture={touch}>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <MessageList
          messages={messages}
          streamingAssistant={streamingAssistant}
          sourceChatId={chatId}
        />
      </div>

      {error && (
        <div className="px-10 py-2 text-[12px] text-muted border-t border-divider">
          {error}
        </div>
      )}

      <div className="border-t border-divider px-10 py-5" onMouseDown={touch}>
        <Composer onSend={onSend} disabled={isStreaming} />
      </div>
    </div>
  );
}
