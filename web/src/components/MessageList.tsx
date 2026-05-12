// Renders a transcript-style message list. Speaker name in display type,
// body in body type. Generous whitespace between messages. Auto-scrolls to
// the bottom as new content arrives.
//
// v2: one speaker on the assistant side ("Manager") — no per-employee names.

import { useEffect, useRef } from "react";
import { Message } from "./Message";
import type { ChatMessage } from "../types";

interface Props {
  messages: ChatMessage[];
  streamingAssistant: string | null;
  sourceChatId: string;
}

export function MessageList({ messages, streamingAssistant, sourceChatId }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streamingAssistant]);

  return (
    <div className="px-10 py-8 max-w-[760px]">
      {messages.length === 0 && streamingAssistant === null ? (
        <FirstGreeting />
      ) : (
        <ul className="space-y-10">
          {messages.map((m) => (
            <li key={m.id}>
              <Message
                role={m.role}
                content={m.content}
                speakerLabel={m.role === "user" ? "You" : "Manager"}
                sourceChatId={sourceChatId}
              />
            </li>
          ))}
          {streamingAssistant !== null && (
            <li>
              <Message
                role="assistant"
                content={streamingAssistant}
                speakerLabel="Manager"
                streaming
                sourceChatId={sourceChatId}
              />
            </li>
          )}
        </ul>
      )}
      <div ref={endRef} />
    </div>
  );
}

function FirstGreeting() {
  return (
    <div>
      <div className="font-display text-[15px] text-muted mb-3">Manager</div>
      <p className="text-ink leading-relaxed">Ready when you are.</p>
    </div>
  );
}
