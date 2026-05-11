// Full-width row of workspace tabs across the very top of the page. The CEO
// tab is permanent and leftmost (no close affordance). Project tabs appear
// in open-order to its right, each with a hover-reveal × to close that
// workspace. A "+ new project" entry on the far right opens NewProjectModal.

import { useStore } from "../state/store";
import {
  projectIdFromWorkspaceId,
  type WorkspaceId,
  type WorkspaceState,
} from "../types";

interface Props {
  onNewProject: () => void;
}

export function WorkspaceTabBar({ onNewProject }: Props) {
  const { state, switchWorkspace, closeWorkspace } = useStore();
  const active = state.activeWorkspaceId;

  // Lookup project name by id from the projects list so renames reflect
  // immediately in tab labels.
  const projectName = (workspace: WorkspaceState): string => {
    const projectId = projectIdFromWorkspaceId(workspace.id);
    if (!projectId) return "Workspace";
    return (
      state.projects.find((p) => p.id === projectId)?.name ?? "Untitled project"
    );
  };

  return (
    <div className="shrink-0 flex items-stretch border-b border-divider bg-bg relative z-[2]">
      {state.workspaces.map((ws) => {
        const isActive = ws.id === active;
        const isCeo = ws.id === "ceo";
        const label = isCeo ? "The CEO" : projectName(ws);
        return (
          <WorkspaceTab
            key={ws.id}
            active={isActive}
            label={label}
            closeable={!isCeo}
            onClick={() => switchWorkspace(ws.id as WorkspaceId)}
            onClose={() => {
              const pid = projectIdFromWorkspaceId(ws.id);
              if (pid) closeWorkspace(pid);
            }}
          />
        );
      })}

      <div className="flex-1" />

      <button
        onClick={onNewProject}
        className="px-5 py-3 text-[13px] text-muted hover:text-ink transition-colors"
      >
        + new project
      </button>
    </div>
  );
}

interface WorkspaceTabProps {
  active: boolean;
  label: string;
  closeable: boolean;
  onClick: () => void;
  onClose: () => void;
}

function WorkspaceTab({ active, label, closeable, onClick, onClose }: WorkspaceTabProps) {
  return (
    <div className="group relative flex items-center">
      <button
        onClick={onClick}
        className={`relative h-full pl-5 pr-${closeable ? "4" : "5"} py-3 transition-colors ${
          active ? "" : "hover:bg-surface/50"
        }`}
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-2 bottom-2 w-px bg-accent pointer-events-none"
          />
        )}
        <span
          className={`font-display text-[15px] tracking-tight whitespace-nowrap ${
            active ? "text-ink font-semibold" : "text-muted"
          }`}
        >
          {label}
        </span>
      </button>
      {closeable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="px-2 self-center text-[14px] text-muted hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label={`Close ${label}`}
        >
          ×
        </button>
      )}
    </div>
  );
}
