// Inline cast affordance: thin-ruled box, employee name in display, reason
// in body, "Open chat →" button in accent. On click: POST /cast, then
// navigate the user into the new context-loaded chat.

import { useState } from "react";
import { motion } from "motion/react";
import { castEmployee } from "../lib/api";
import { pathForEmployeeChat, useRouter } from "../router";
import { CHARACTER_NAMES, CHARACTER_ROLES } from "./characterNames";
import type { EmployeeId } from "../types";

interface Props {
  employee: EmployeeId;
  project: string;
  task: string;
  reason: string;
  sourceChatId: string;
}

export function CastSuggestion({ employee, project, task, reason, sourceChatId }: Props) {
  const { navigate } = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onOpen = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await castEmployee({
        projectId: project,
        employee,
        task,
        sourceChatId,
      });
      navigate(pathForEmployeeChat(result.projectId, result.chatId));
    } catch (e) {
      setError((e as Error).message);
      setPending(false);
    }
  };

  return (
    <motion.aside
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="my-5 border border-divider rounded-sm bg-surface/40 px-5 py-4 max-w-prose"
    >
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted mb-2">
        Suggested cast
      </div>
      <div className="flex items-baseline gap-3">
        <div className="font-display text-xl text-ink leading-tight">
          {CHARACTER_NAMES[employee]}
        </div>
        <div className="text-[12px] text-muted">{CHARACTER_ROLES[employee]}</div>
      </div>
      <p className="mt-2 text-[14px] text-ink leading-relaxed">{reason}</p>
      <div className="mt-1 text-[12px] text-muted italic leading-relaxed">
        Task: {task}
      </div>

      <div className="mt-3 flex items-center gap-4">
        <button
          onClick={onOpen}
          disabled={pending}
          className="text-[13px] text-accent disabled:opacity-50 hover:underline underline-offset-2"
        >
          {pending ? "opening…" : "Open chat →"}
        </button>
        {error && <span className="text-[12px] text-muted">{error}</span>}
      </div>
    </motion.aside>
  );
}
