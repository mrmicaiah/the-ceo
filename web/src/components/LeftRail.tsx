// Left rail: app title block, the CEO list item, a hairline rule, then the
// project list. Each project row carries its "workspace open" state and an
// "active workspace" highlight; toggling open/close moves the project in or
// out of the top workspace tab bar.
//
// New project affordance stays at the bottom of the rail. (There's also one
// at the right end of the workspace tab bar — both open the same modal.)

import { useStore } from "../state/store";
import { ProjectListItem } from "./ProjectListItem";
import { workspaceIdForProject } from "../types";

interface Props {
  onNewProject: () => void;
}

export function LeftRail({ onNewProject }: Props) {
  const { state, switchWorkspace } = useStore();
  const active = state.activeWorkspaceId;
  const ceoActive = active === "ceo";

  const openWorkspaceIds = new Set(state.workspaces.map((w) => w.id));

  const goCeo = () => switchWorkspace("ceo");

  return (
    <div className="flex h-full flex-col" style={{ position: "relative", zIndex: 2 }}>
      {/* ── App title block ──────────────────────────────────────── */}
      <div className="px-6 pt-7 pb-6">
        <button
          onClick={goCeo}
          className="block w-full text-left"
          aria-label="Go to The CEO"
        >
          <div className="font-display text-2xl text-ink leading-none">The CEO</div>
          <div className="mt-1.5 text-[12px] text-muted tracking-wide">
            Chief Executive Orchestrator
          </div>
        </button>
      </div>

      {/* ── CEO entry ────────────────────────────────────────────── */}
      <nav className="px-3">
        <CeoEntry active={ceoActive} onClick={goCeo} />
      </nav>

      <div className="px-6 my-4">
        <div className="h-px bg-divider" />
      </div>

      {/* ── Projects ─────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3">
        <div className="px-3 pb-2 text-[11px] uppercase tracking-[0.12em] text-muted">
          Projects
        </div>

        {state.projectsLoading ? (
          <div className="px-3 py-2 text-sm text-muted italic editorial-shimmer">
            loading projects
          </div>
        ) : state.projectsError ? (
          <div className="px-3 py-2 text-sm text-muted">
            Couldn't load projects.
          </div>
        ) : state.projects.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted leading-snug">
            No projects yet. Open the CEO to start one.
          </div>
        ) : (
          <ul className="space-y-px">
            {state.projects.map((p) => {
              const id = workspaceIdForProject(p.id);
              const isOpen = openWorkspaceIds.has(id);
              const isActive = isOpen && active === id;
              return (
                <ProjectListItem
                  key={p.id}
                  project={p}
                  open={isOpen}
                  active={isActive}
                />
              );
            })}
          </ul>
        )}
      </div>

      {/* ── New project ──────────────────────────────────────────── */}
      <div className="px-6 py-5 border-t border-divider">
        <button
          onClick={onNewProject}
          className="text-[13px] text-muted hover:text-ink transition-colors"
        >
          New project
        </button>
      </div>
    </div>
  );
}

function CeoEntry({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative block w-full text-left px-3 py-2 hover:bg-surface/60 transition-colors"
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1 bottom-1 w-px bg-accent"
        />
      )}
      <span
        className={`font-display text-[17px] ${
          active ? "text-accent font-semibold" : "text-ink"
        }`}
      >
        The CEO
      </span>
    </button>
  );
}
