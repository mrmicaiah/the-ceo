// Top-level v2 layout.
//
//   +---------------------------------------------------------------+
//   | [Project A] [Project B] [• Project C (min)]            [+]    |  project dock
//   +---------------------------------------------------------------+
//   |                                                               |
//   |                                                               |
//   |               WORKSPACE — edge-to-edge pane grid              |
//   |                                                               |
//   |                                                               |
//   +---------------------------------------------------------------+
//   | [drop a note...]                  [Brainstorm Room] [Board]   |  bottom bar
//   +---------------------------------------------------------------+
//
// No left rail. No right rail. No CEO permanent tab. The CEO surface is
// retired in v2; the Brainstorm Room (later run) is its successor.

import { ProjectTopBar } from "./ProjectTopBar";
import { Workspace } from "./Workspace";
import { AppBottomBar } from "./AppBottomBar";

export function AppShell() {
  return (
    <div className="relative flex h-full w-full overflow-hidden flex-col">
      <ProjectTopBar />
      <main className="flex-1 min-h-0 min-w-0">
        <Workspace />
      </main>
      <AppBottomBar />
    </div>
  );
}
