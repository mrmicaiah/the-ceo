// Restrained text field at the bottom of the chat. Autosizes vertically up
// to a cap, then scrolls. Submit on Enter; newline on Shift+Enter. The
// Return ↵ hint sits to the right.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

const MAX_HEIGHT_PX = 200;

export function Composer({ onSend, disabled }: Props) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Autosize.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT_PX) + "px";
  }, [text]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex items-end gap-4">
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Write a message"
        disabled={disabled}
        rows={1}
        className="flex-1 text-[15px] text-ink placeholder:text-muted/70 disabled:opacity-50 leading-relaxed"
        style={{ minHeight: "1.6em" }}
      />
      <div className="text-[11px] text-muted/80 select-none pb-1.5 shrink-0">
        <span className="font-mono">Return ↵</span>
      </div>
    </div>
  );
}
