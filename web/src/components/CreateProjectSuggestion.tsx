// Inline affordance for the CEO's create_project suggestion. Same family as
// CastSuggestion: thin-ruled box, surface fill, display + body + accent action.
//
// On click: POST /api/projects, then add to the rail. The user stays in the
// CEO chat — the new project just appears in the rail. Show a brief "Created"
// state, then collapse to a small note.

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { createProject } from "../lib/api";
import { useStore } from "../state/store";

interface Props {
  name: string;
  initialGoal: string;
  reason: string;
}

export function CreateProjectSuggestion({ name, initialGoal, reason }: Props) {
  const { state, addProject } = useStore();
  const [phase, setPhase] = useState<"idle" | "pending" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  // If a project with this name already exists in the rail, treat as already
  // created (e.g., the user clicked previously, then refreshed). This prevents
  // accidental double-creation when revisiting an old message.
  const existing = useMemo(
    () =>
      state.projects.find(
        (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase(),
      ),
    [state.projects, name],
  );

  useEffect(() => {
    if (existing && phase === "idle") setPhase("done");
  }, [existing, phase]);

  const onClick = async () => {
    if (phase === "pending" || phase === "done") return;
    setPhase("pending");
    setError(null);
    try {
      const project = await createProject({ name, initialGoal });
      addProject(project);
      setPhase("done");
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {phase === "done" ? (
        <motion.div
          key="note"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="my-4 text-[13px] text-muted italic"
        >
          Created project <span className="not-italic text-ink">{name}</span>.
        </motion.div>
      ) : (
        <motion.aside
          key="card"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="my-5 border border-divider rounded-sm bg-surface/40 px-5 py-4 max-w-prose"
        >
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted mb-2">
            Suggested new project
          </div>
          <div className="font-display text-xl text-ink leading-tight">
            {name}
          </div>
          <p className="mt-2 text-[14px] text-ink leading-relaxed">{reason}</p>
          <div className="mt-1 text-[12px] text-muted italic leading-relaxed">
            Goal: {initialGoal}
          </div>

          <div className="mt-3 flex items-center gap-4">
            <button
              onClick={onClick}
              disabled={phase === "pending"}
              className="text-[13px] text-accent disabled:opacity-50 hover:underline underline-offset-2"
            >
              {phase === "pending" ? "creating…" : "Create project →"}
            </button>
            {error && (
              <span className="text-[12px] text-muted">{error}</span>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
