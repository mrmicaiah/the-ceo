// Auto-action inline note: the CEO emitted an update_briefing block.
// Fires POST /api/projects/:id/briefing-update once when this note mounts in
// a live context. If the user is currently viewing this project's right rail
// briefing, refresh it so the change animates in.
//
// Idempotency: setting a field to the same value is harmless (it just bumps
// updated_at). Acceptable cost for a guard that can't perfectly distinguish
// "first fire" from "re-mount after history reload."

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { getBriefing, updateBriefingField } from "../lib/api";
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
  const { state, setBriefing } = useStore();
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
        // If the user is currently viewing this project's briefing, refresh
        // it so the right rail animates the change.
        if (state.currentBriefingProjectId === project) {
          const fresh = await getBriefing(project).catch(() => null);
          if (fresh) setBriefing(fresh, project);
        }
      } catch (err) {
        setLastError((err as Error).message);
      }
    })();
  }, [isLive, project, field, value, state.currentBriefingProjectId, setBriefing]);

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
