// Auto-action inline note: the CEO emitted an update_briefing block.
// Fires POST /api/projects/:id/briefing-update once when this note mounts in
// a live context, then dispatches a "ceo:briefing-updated" CustomEvent so any
// open project workspace for this projectId can refresh its briefing rail.
//
// Run #7: briefings are no longer global state — each project workspace owns
// its own briefing fetch. The custom event is how the auto-action talks to
// open workspaces without coupling components.

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { updateBriefingField } from "../lib/api";
import { useStore } from "../state/store";
import type { BriefingField } from "../lib/actions";

interface Props {
  project: string;
  field: BriefingField;
  value: string;
  isLive: boolean;
}

const FIELD_LABELS: Record<BriefingField, string> = {
  goal: "goal",
  state: "state",
  nextMove: "next move",
  why: "why",
};

export function BriefingUpdateNote({ project, field, value, isLive }: Props) {
  const { state } = useStore();
  const fired = useRef(false);
  const [_lastError, setLastError] = useState<string | null>(null);

  const projectName =
    state.projects.find((p) => p.id === project)?.name ?? "the project";

  useEffect(() => {
    if (!isLive) return;
    if (fired.current) return;
    fired.current = true;
    (async () => {
      try {
        await updateBriefingField(project, field, value);
        // Tell any open workspace for this project that its briefing
        // should be re-fetched.
        window.dispatchEvent(
          new CustomEvent("ceo:briefing-updated", {
            detail: { projectId: project },
          }),
        );
      } catch (err) {
        setLastError((err as Error).message);
      }
    })();
  }, [isLive, project, field, value]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="my-4 text-[13px] text-muted italic"
    >
      Updated the <span className="not-italic text-ink">{FIELD_LABELS[field]}</span>{" "}
      for <span className="not-italic text-ink">{projectName}</span>.
    </motion.div>
  );
}
