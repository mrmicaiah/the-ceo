// Top bar — the project dock + the v3 picker.
//
// Tabs:
//   - Each open project is a tab. Active = ink + 1px accent left-edge bar.
//   - Inactive open = ink, no bar. Minimized = muted with notification dot
//     when activity occurred while minimized.
//   - Hover reveals × to close from the dock.
//
// + button opens the v3 picker — a two-section dropdown:
//
//   YOUR PROJECTS  (claimed repos: isProject === true)
//   ─────────────
//   the-ceo
//   refervo-app
//
//   OTHER REPOS  (unclaimed repos: isProject === false)
//   ─────────────
//   some-other-repo                       Make this a project →
//   another-experiment                    Make this a project →
//
//   ─────────────
//   + New project
//
// Clicking a "Your projects" row opens the workspace. Clicking
// "Make this a project →" on an "Other repos" row calls /api/projects/from-repo
// then opens the workspace. The + New project footer opens NewProjectModal.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { claimRepoAsProject, listRepos } from "../lib/api";
import { useStore } from "../state/store";
import type { RepoListItem, WorkspaceState } from "../types";
import { NewProjectModal } from "./NewProjectModal";

export function ProjectTopBar() {
  const {
    state,
    openProject,
    closeProject,
    switchToProject,
    restoreProject,
  } = useStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newModalOpen, setNewModalOpen] = useState(false);

  const onTabClick = (ws: WorkspaceState) => {
    if (ws.minimized) {
      restoreProject(ws.projectId);
    } else if (state.activeWorkspaceId !== ws.id) {
      switchToProject(ws.projectId);
    }
  };

  return (
    <>
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
                projectName={ws.repoFullName}
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
                openProjectIds={new Set(state.workspaces.map((w) => w.projectId))}
                onPick={(id, repoFullName) => {
                  openProject(id, repoFullName);
                  setPickerOpen(false);
                }}
                onNewProject={() => {
                  setPickerOpen(false);
                  setNewModalOpen(true);
                }}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
      <NewProjectModal open={newModalOpen} onClose={() => setNewModalOpen(false)} />
    </>
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

// ── Picker ──────────────────────────────────────────────────────────

interface PickerProps {
  openProjectIds: Set<string>;
  onPick: (projectId: string, repoFullName: string) => void;
  onNewProject: () => void;
  onClose: () => void;
}

function ProjectPicker({ openProjectIds, onPick, onNewProject, onClose }: PickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [repos, setRepos] = useState<RepoListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const list = await listRepos();
        if (!canceled) setRepos(list);
      } catch (err) {
        if (!canceled) setError((err as Error).message);
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  const onClaimAndOpen = async (repo: RepoListItem) => {
    if (claiming) return;
    setClaiming(repo.fullName);
    setError(null);
    try {
      const result = await claimRepoAsProject({
        repoFullName: repo.fullName,
        cloneUrl: repo.cloneUrl,
        defaultBranch: repo.defaultBranch,
      });
      onPick(result.projectId, result.repoFullName);
    } catch (err) {
      setError((err as Error).message);
      setClaiming(null);
    }
  };

  const claimed = (repos ?? []).filter(
    (r) => r.isProject && !openProjectIds.has(r.projectId ?? ""),
  );
  const unclaimed = (repos ?? []).filter((r) => !r.isProject);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
      className="absolute top-full right-0 mt-1 w-[360px] max-h-[70vh] overflow-y-auto bg-bg border border-divider rounded-sm shadow-md z-20"
    >
      {error ? (
        <div className="px-4 py-3 text-[12px] text-muted">{error}</div>
      ) : repos === null ? (
        <div className="px-4 py-3 text-[12px] text-muted italic editorial-shimmer">
          loading repos from GitHub
        </div>
      ) : repos.length === 0 ? (
        <div className="px-4 py-3 text-[12px] text-muted italic">
          No repos found on your GitHub account. Create one to get started.
        </div>
      ) : (
        <>
          <SectionHeader>Your projects</SectionHeader>
          {claimed.length === 0 ? (
            <div className="px-4 py-2 text-[12px] text-muted italic">
              No projects yet — claim a repo below.
            </div>
          ) : (
            <ul>
              {claimed.map((r) => (
                <li key={r.fullName}>
                  <button
                    onClick={() => r.projectId && onPick(r.projectId, r.fullName)}
                    className="w-full text-left px-4 py-2 hover:bg-surface/40 transition-colors"
                  >
                    <div className="font-display text-[14px] text-ink truncate">
                      {r.fullName}
                    </div>
                    {r.description && (
                      <div className="text-[11px] text-muted truncate">
                        {r.description}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <SectionHeader>Other repos</SectionHeader>
          {unclaimed.length === 0 ? (
            <div className="px-4 py-2 text-[12px] text-muted italic">
              All repos already claimed.
            </div>
          ) : (
            <ul>
              {unclaimed.map((r) => (
                <li key={r.fullName} className="group flex items-center">
                  <div className="flex-1 px-4 py-2 min-w-0">
                    <div className="font-display text-[14px] text-ink truncate">
                      {r.fullName}
                    </div>
                    {r.description && (
                      <div className="text-[11px] text-muted truncate">
                        {r.description}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => onClaimAndOpen(r)}
                    disabled={claiming === r.fullName}
                    className="shrink-0 pr-4 text-[12px] text-accent hover:underline underline-offset-2 disabled:opacity-50 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  >
                    {claiming === r.fullName
                      ? "claiming…"
                      : "Make this a project →"}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-divider mt-1">
            <button
              onClick={onNewProject}
              className="w-full text-left px-4 py-3 text-[13px] text-accent hover:underline underline-offset-2"
            >
              + New project
            </button>
          </div>
        </>
      )}
    </motion.div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-[0.16em] text-muted border-t border-divider first:border-t-0">
      {children}
    </div>
  );
}
