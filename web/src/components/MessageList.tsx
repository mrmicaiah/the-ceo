// Renders a transcript-style message list. Speaker name in display type,
// body in body type. Generous whitespace between messages. Auto-scrolls to
// the bottom as new content arrives.

import { useEffect, useRef } from "react";
import { Message } from "./Message";
import type { ChatMessage, EmployeeId } from "../types";

interface Props {
  messages: ChatMessage[];
  streamingAssistant: string | null;
  sourceChatId: string;
  kind: "ceo" | "employee";
  employeeId: EmployeeId | null;
}

export function MessageList({ messages, streamingAssistant, sourceChatId, kind, employeeId }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streamingAssistant]);

  const assistantLabel =
    kind === "ceo" ? "The CEO" : employeeId ? employeeId[0].toUpperCase() + employeeId.slice(1) : "Assistant";

  return (
    <div className="px-10 py-8 max-w-[760px]">
      {messages.length === 0 && streamingAssistant === null ? (
        <FirstGreeting kind={kind} />
      ) : (
        <ul className="space-y-10">
          {messages.map((m) => (
            <li key={m.id}>
              <Message
                role={m.role}
                content={m.content}
                speakerLabel={
                  m.role === "user" ? "You" : assistantLabel
                }
                sourceChatId={sourceChatId}
              />
            </li>
          ))}
          {streamingAssistant !== null && (
            <li>
              <Message
                role="assistant"
                content={streamingAssistant}
                speakerLabel={assistantLabel}
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

function FirstGreeting({ kind }: { kind: "ceo" | "employee" }) {
  return (
    <div>
      <div className="font-display text-[15px] text-muted mb-3">
        {kind === "ceo" ? "The CEO" : "—"}
      </div>
      <p className="text-ink leading-relaxed">
        {kind === "ceo"
          ? "What are you working on?"
          : "Ready when you are."}
      </p>
    </div>
  );
}
