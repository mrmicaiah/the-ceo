// Auto-action inline note: the CEO emitted a rename_project block. Fire the
// PATCH once when the note mounts in a live (streaming-or-just-streamed)
// context; render the historical note in any case so old messages still read
// correctly.
//
// Idempotency: PATCH /api/projects/:id with the same name is harmless. The
// useRef guard plus the `isLive` flag prevent double-fires in practice; even
// if a duplicate slips through (React StrictMode double-invoke in dev,
// say), the second PATCH is a no-op at the data level.

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { patchProject } from "../lib/api";
import { useStore } from "../state/store";

interface Props {
  project: string;
  newName: string;
  isLive: boolean;
}

export function RenameNote({ project, newName, isLive }: Props) {
  const { updateProjectLocal } = useStore();
  const fired = useRef(false);

  useEffect(() => {
    if (!isLive) return;
    if (fired.current) return;
    fired.current = true;
    (async () => {
      try {
        const updated = await patchProject(project, { name: newName });
        updateProjectLocal(updated);
      } catch {
        // Silent — the note still renders so the user knows what was attempted.
      }
    })();
  }, [isLive, project, newName, updateProjectLocal]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="my-4 text-[13px] text-muted italic"
    >
      Renamed to <span className="not-italic text-ink">"{newName}"</span>.
    </motion.div>
  );
}
