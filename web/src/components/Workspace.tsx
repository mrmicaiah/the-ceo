// The workspace area — v2. Edge-to-edge. Hosts the ChatGrid of visible
// project panes. No rails, no per-workspace briefing rail, no chat tabs row.
// The project dock (top bar) and bottom bar live around this; the workspace
// is what fills the middle.

import { motion, AnimatePresence } from "motion/react";
import { useStore } from "../state/store";
import { ChatGrid } from "./ChatGrid";

export function Workspace() {
  const { state } = useStore();
  const visible = state.workspaces.filter((w) => !w.minimized);
  const anyOpen = state.workspaces.length > 0;

  if (visible.length === 0) {
    return anyOpen ? <AllMinimizedState /> : <EmptyState />;
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`grid-${visible.length}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="h-full flex flex-col"
      >
        <ChatGrid visibleWorkspaces={visible} />
      </motion.div>
    </AnimatePresence>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center px-10">
      <div className="max-w-[480px] text-center">
        <div className="font-display text-3xl text-ink leading-tight">
          The CEO
        </div>
        <p className="mt-4 text-[14px] text-muted leading-relaxed">
          Open a project from the dock above to start working with its manager.
        </p>
      </div>
    </div>
  );
}

function AllMinimizedState() {
  return (
    <div className="h-full flex items-center justify-center px-10">
      <div className="max-w-[420px] text-center">
        <div className="text-[14px] text-muted leading-relaxed italic">
          All projects minimized. Click a tab above to bring one back.
        </div>
      </div>
    </div>
  );
}
