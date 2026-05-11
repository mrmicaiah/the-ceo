// Three-pane shell per docs/design.md.
//   Left rail (260px) — app title, CEO entry, project list.
//   Main pane (flex) — CEO chat or employee chat or empty/new-project form.
//   Right rail (340px) — briefing card (only when in a project chat).

import { useState } from "react";
import { LeftRail } from "./LeftRail";
import { MainPane } from "./MainPane";
import { RightRail } from "./RightRail";
import { useRouter } from "../router";

export function AppShell() {
  const { route } = useRouter();
  const [showNewProject, setShowNewProject] = useState(false);

  const isProjectChat = route.kind === "employee-chat";

  return (
    <div
      className="relative flex h-full w-full overflow-hidden"
      style={{ position: "relative", zIndex: 0 }}
    >
      <aside
        className="shrink-0 border-r border-divider"
        style={{ width: 260 }}
      >
        <LeftRail
          onNewProject={() => setShowNewProject(true)}
          onCeoSelected={() => setShowNewProject(false)}
        />
      </aside>

      <main className="flex-1 min-w-0">
        <MainPane
          showNewProject={showNewProject}
          onCancelNewProject={() => setShowNewProject(false)}
          onProjectCreated={() => setShowNewProject(false)}
        />
      </main>

      {isProjectChat && !showNewProject && (
        <aside
          className="shrink-0 border-l border-divider hidden lg:block"
          style={{ width: 340 }}
        >
          <RightRail />
        </aside>
      )}
    </div>
  );
}
