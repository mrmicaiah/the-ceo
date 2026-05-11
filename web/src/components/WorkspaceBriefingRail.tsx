// The briefing rail for a project workspace. Each workspace owns its own
// briefing fetch — there's no shared global briefing state anymore.
//
// 340px when open; ~28px strip when collapsed. The chevron lives at the
// LEFT edge so it stays visible (and clickable) when collapsed. Collapsed
// state is persisted per-workspace via workspace.briefingCollapsed.

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getBriefing } from "../lib/api";
import { useStore } from "../state/store";
import { BriefingCard } from "./BriefingCard";
import type { Briefing, WorkspaceState } from "../types";

interface Props {
  workspace: WorkspaceState;
  briefing: Briefing | null;
  briefingError: string | null;
  onBriefingFetched: (briefing: Briefing | null) => void;
}

const OPEN_WIDTH = 340;
const COLLAPSED_WIDTH = 28;

export function WorkspaceBriefingRail({
  workspace,
  briefing,
  briefingError,
  onBriefingFetched,
}: Props) {
  const { toggleBriefing } = useStore();
  const projectId = workspace.projectId;
  const collapsed = workspace.briefingCollapsed;

  // Listen for CEO update_briefing actions and refetch when our project matches.
  useEffect(() => {
    if (!projectId) return;
    const onUpdate = (e: Event) => {
      const ce = e as CustomEvent<{ projectId?: string }>;
      if (ce.detail?.projectId !== projectId) return;
      void (async () => {
        const fresh = await getBriefing(projectId).catch(() => null);
        onBriefingFetched(fresh);
      })();
    };
    window.addEventListener("ceo:briefing-updated", onUpdate as EventListener);
    return () =>
      window.removeEventListener("ceo:briefing-updated", onUpdate as EventListener);
  }, [projectId, onBriefingFetched]);

  return (
    <aside
      className="shrink-0 border-l border-divider relative transition-[width] duration-300 ease-out"
      style={{ width: collapsed ? COLLAPSED_WIDTH : OPEN_WIDTH }}
    >
      {/* Chevron at left edge — always present. */}
      <button
        onClick={() => toggleBriefing(workspace.id)}
        className="absolute left-0 top-6 -translate-x-1/2 w-5 h-5 flex items-center justify-center bg-bg border border-divider rounded-full text-[10px] text-muted hover:text-ink transition-colors z-10"
        aria-label={collapsed ? "Expand briefing" : "Collapse briefing"}
        title={collapsed ? "Expand briefing" : "Collapse briefing"}
      >
        {collapsed ? "›" : "‹"}
      </button>

      {/* Contents shown only when expanded. */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="h-full overflow-y-auto px-7 py-8"
          >
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted mb-5">
              Briefing
            </div>
            {briefingError ? (
              <div className="text-sm text-muted leading-snug">{briefingError}</div>
            ) : briefing ? (
              <motion.div
                key={briefing.updatedAt}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                <BriefingCard briefing={briefing} />
              </motion.div>
            ) : (
              <div className="text-sm text-muted italic editorial-shimmer">
                loading briefing
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}
