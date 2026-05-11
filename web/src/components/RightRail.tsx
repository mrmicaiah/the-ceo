// Right rail: the briefing card for the current project chat. Animates
// content swap via a soft fade-and-shift when the briefing updates.

import { AnimatePresence, motion } from "motion/react";
import { useStore } from "../state/store";
import { BriefingCard } from "./BriefingCard";

export function RightRail() {
  const { state } = useStore();
  const briefing = state.currentBriefing;

  return (
    <div className="h-full overflow-y-auto px-7 py-8" style={{ position: "relative", zIndex: 2 }}>
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted mb-5">
        Briefing
      </div>
      <AnimatePresence mode="wait">
        {briefing ? (
          <motion.div
            key={briefing.updatedAt}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <BriefingCard briefing={briefing} />
          </motion.div>
        ) : (
          <motion.div
            key="placeholder"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-sm text-muted italic editorial-shimmer"
          >
            loading briefing
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
