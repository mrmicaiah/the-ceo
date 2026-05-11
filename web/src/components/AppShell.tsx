// Top-level layout. Workspace tabs span the full width across the top.
// Below: a 260px left rail (project switcher) + the workspace content.
//
//   +---------------------------------------------------------------+
//   | [The CEO] [Project A] [Project B]            + new project    |
//   +---------------------------------------------------------------+
//   | LEFT RAIL    | WORKSPACE CONTENT                              |
//   | (260px)      | (varies by workspace type, see Workspace.tsx)  |
//   +---------------------------------------------------------------+

import { useState } from "react";
import { useStore } from "../state/store";
import { LeftRail } from "./LeftRail";
import { NewProjectModal } from "./NewProjectModal";
import { Workspace } from "./Workspace";
import { WorkspaceTabBar } from "./WorkspaceTabBar";

export function AppShell() {
  const { state } = useStore();
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  return (
    <div className="relative flex h-full w-full overflow-hidden flex-col">
      <WorkspaceTabBar onNewProject={() => setNewProjectOpen(true)} />

      <div className="flex flex-1 min-h-0">
        <aside
          className="shrink-0 border-r border-divider"
          style={{ width: 260 }}
        >
          <LeftRail onNewProject={() => setNewProjectOpen(true)} />
        </aside>
        <main className="flex-1 min-w-0">
          <Workspace
            // Re-mount the inner Workspace when the active workspace changes
            // so per-workspace state (briefing fetch, scroll, etc.) is fresh.
            key={state.activeWorkspaceId}
            workspaceId={state.activeWorkspaceId}
          />
        </main>
      </div>

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
      />
    </div>
  );
}
