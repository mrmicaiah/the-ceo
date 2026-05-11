// Small affordance to wrap an employee+project chat. Triggers the report
// flow on the server; on success, hands back the updated briefing so the
// right rail can animate to the new state.
//
// Always-visible explanatory note above the button (when employee + project
// context is known) so the user knows what wrapping does before clicking:
// reports flow up to the project briefing for the named project.

import { useState } from "react";
import { wrapChat } from "../lib/api";
import type { Briefing } from "../types";

interface Props {
  chatId: string;
  employeeName: string | null;
  projectName: string | null;
  onWrapped: (newBriefing: Briefing | null) => void;
}

export function WrapChatButton({ chatId, employeeName, projectName, onWrapped }: Props) {
  const [state, setState] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onClick = async () => {
    if (state === "pending") return;
    setState("pending");
    setErrorMsg(null);
    try {
      const result = await wrapChat(chatId);
      if (result.briefing) onWrapped(result.briefing);
      setState("done");
    } catch (err) {
      setErrorMsg((err as Error).message);
      setState("error");
    }
  };

  if (state === "pending") {
    return (
      <span className="text-[12px] text-muted italic editorial-shimmer">
        updating briefing
      </span>
    );
  }
  if (state === "done") {
    return (
      <span className="text-[12px] text-muted italic">briefing updated</span>
    );
  }

  const showNote = !!employeeName && !!projectName;

  return (
    <div className="flex flex-col items-end gap-1.5">
      {showNote && (
        <div className="text-[11px] text-muted max-w-[280px] text-right leading-snug">
          Wrapping files a report from {employeeName} to your briefing for &ldquo;{projectName}&rdquo;.
        </div>
      )}
      <div className="flex items-center gap-3">
        {errorMsg && (
          <span className="text-[12px] text-muted">{errorMsg}</span>
        )}
        <button
          onClick={onClick}
          className="text-[13px] text-muted hover:text-ink transition-colors"
        >
          Wrap this chat
        </button>
      </div>
    </div>
  );
}
