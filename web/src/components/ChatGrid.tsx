// Grid of visible project panes. v2: each cell is one project's manager
// chat. Layout adapts by count, same logic as v1's chat grid (run #7):
//   1 → single pane fills the area
//   2 → side-by-side, 50/50
//   3 → Option A: 2 on top + 1 full-width on bottom
//   4 → 2x2
//
// Hairline dividers applied as borders on panes (right + bottom where
// appropriate).

import { ProjectPane } from "./ProjectPane";
import type { WorkspaceState } from "../types";

interface Props {
  visibleWorkspaces: WorkspaceState[];
}

export function ChatGrid({ visibleWorkspaces }: Props) {
  const n = visibleWorkspaces.length;
  if (n === 0) return null;

  const containerClass =
    n === 1
      ? "grid-cols-1 grid-rows-1"
      : n === 2
        ? "grid-cols-2 grid-rows-1"
        : "grid-cols-2 grid-rows-2";

  return (
    <div className={`flex-1 grid min-h-0 ${containerClass}`}>
      {visibleWorkspaces.map((ws, idx) => {
        const spansFull = n === 3 && idx === 2;
        const isLeftCol = idx % 2 === 0;
        const hasNeighborRight =
          !spansFull && isLeftCol && idx + 1 < n && !(n === 3 && idx + 1 === 2);
        const isTopRow = n > 2 && idx < 2;

        const classNames = [
          spansFull ? "col-span-2" : "",
          hasNeighborRight ? "border-r border-divider" : "",
          isTopRow ? "border-b border-divider" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <ProjectPane
            key={ws.id}
            projectId={ws.projectId}
            className={classNames}
          />
        );
      })}
    </div>
  );
}
