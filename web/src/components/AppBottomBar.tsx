// Bottom bar — thin, single-row, hairline rule above.
//
// Left half: the DropnoteBox (always-on stray-thought capture).
// Right half: two surface buttons — "Brainstorm Room" and "Board". Both
// render a "coming soon" indication when clicked; surfaces themselves land
// in later v2 runs.

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { DropnoteBox } from "./DropnoteBox";

export function AppBottomBar() {
  return (
    <div className="shrink-0 flex items-center border-t border-divider bg-bg">
      <div className="flex-1 min-w-0 px-5 py-2">
        <DropnoteBox />
      </div>
      <div className="shrink-0 flex items-center gap-2 px-5 py-2">
        <ComingSoonButton label="Brainstorm Room" />
        <ComingSoonButton label="Board" />
      </div>
    </div>
  );
}

function ComingSoonButton({ label }: { label: string }) {
  const [showHint, setShowHint] = useState(false);

  const onClick = () => {
    setShowHint(true);
    window.setTimeout(() => setShowHint(false), 2000);
  };

  return (
    <div className="relative">
      <button
        onClick={onClick}
        className="text-[12px] text-muted hover:text-ink transition-colors px-3 py-1 border border-divider rounded-sm"
      >
        {label}
      </button>
      <AnimatePresence>
        {showHint && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-full mb-2 right-0 whitespace-nowrap text-[11px] text-muted italic"
          >
            coming soon
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
