// Top bar — the project dock. Full width, spans across.
//
// Tabs:
//   - Each open project is a tab. Visible (in the grid) = ink text;
//     minimized = muted with a notification dot when activity has occurred.
//   - The active project gets a 1px accent left-edge bar.
//   - Hover reveals a small × to close the project from the workspace.
//   - Click switches/restores; click while already active is a no-op.
//
// + button on the right end opens a small project picker dropdown — lists
// projects not currently in the dock. Click one to open it.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useStore } from "../state/store";
import type { ProjectListItem, WorkspaceState } from "../types";

export function ProjectTopBar() {
  const {
    state,
    openProject,
    closeProject,
    switchToProject,
    restoreProject,
  } = useStore();
  const [pickerOpen, setPickerOpen] = useState(false);

  const onTabClick = (ws: WorkspaceState) => {
    if (ws.minimized) {
      restoreProject(ws.projectId);
    } else if (state.activeWorkspaceId !== ws.id) {
      switchToProject(ws.projectId);
    }
  };

  return (
    <div className="shrink-0 flex items-stretch border-b border-divider bg-bg overflow-x-auto">
      {state.workspaces.length === 0 ? (
        <div className="flex-1 px-6 py-2 text-[12px] text-muted italic">
          No projects open.
        </div>
      ) : (
        <div className="flex items-stretch">
          {state.workspaces.map((ws) => (
            <ProjectTab
              key={ws.id}
              ws={ws}
              isActive={state.activeWorkspaceId === ws.id}
              projectName={
                state.projects.find((p) => p.id === ws.projectId)?.name ??
                "(loading…)"
              }
              onClick={() => onTabClick(ws)}
              onClose={() => closeProject(ws.projectId)}
            />
          ))}
          <div className="flex-1" />
        </div>
      )}
      <div className="relative ml-auto shrink-0 flex items-center">
        <button
          onClick={() => setPickerOpen((v) => !v)}
          className="px-4 py-2 text-[13px] text-muted hover:text-ink transition-colors"
          aria-label="Open a project"
          title="Open a project"
        >
          +
        </button>
        <AnimatePresence>
          {pickerOpen && (
            <ProjectPicker
              projects={state.projects}
              openProjectIds={new Set(state.workspaces.map((w) => w.projectId))}
              onPick={(id) => {
                openProject(id);
                setPickerOpen(false);
              }}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

interface TabProps {
  ws: WorkspaceState;
  isActive: boolean;
  projectName: string;
  onClick: () => void;
  onClose: () => void;
}

function ProjectTab({ ws, isActive, projectName, onClick, onClose }: TabProps) {
  const muted = ws.minimized;
  return (
    <div className="group relative flex items-center shrink-0">
      <button
        onClick={onClick}
        className="relative max-w-[280px] pl-4 pr-2 py-2 transition-colors"
        title={projectName}
      >
        {isActive && (
          <span
            aria-hidden
            className="absolute left-0 top-1.5 bottom-1.5 w-px bg-accent pointer-events-none"
          />
        )}
        <div className="flex items-baseline gap-2 min-w-0">
          {muted && ws.hasUnread && (
            <span
              aria-hidden
              className="text-accent text-[12px] leading-none"
              title="activity"
            >
              •
            </span>
          )}
          <span
            className={`font-display text-[14px] tracking-tight whitespace-nowrap ${
              muted ? "text-muted" : "text-ink"
            }`}
          >
            {projectName}
          </span>
        </div>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="self-center px-2 text-[13px] text-muted hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label={`Close ${projectName}`}
        title="Close from dock"
      >
        ×
      </button>
    </div>
  );
}

interface PickerProps {
  projects: ProjectListItem[];
  openProjectIds: Set<string>;
  onPick: (id: string) => void;
  onClose: () => void;
}

function ProjectPicker({ projects, openProjectIds, onPick, onClose }: PickerProps) {
  // Close on outside click.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  const available = projects.filter((p) => !openProjectIds.has(p.id));

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
      className="absolute top-full right-0 mt-1 min-w-[260px] max-h-[60vh] overflow-y-auto bg-bg border border-divider rounded-sm shadow-md z-20"
    >
      {projects.length === 0 ? (
        <div className="px-4 py-3 text-[12px] text-muted italic">
          No projects yet.
        </div>
      ) : available.length === 0 ? (
        <div className="px-4 py-3 text-[12px] text-muted italic">
          All projects are already open.
        </div>
      ) : (
        <ul>
          {available.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => onPick(p.id)}
                className="w-full text-left px-4 py-2 hover:bg-surface/40 transition-colors"
              >
                <div className="font-display text-[14px] text-ink truncate">
                  {p.name}
                </div>
                {p.goal && (
                  <div className="text-[11px] text-muted truncate">
                    {p.goal}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}
