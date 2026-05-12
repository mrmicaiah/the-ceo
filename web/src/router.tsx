// Workspace-aware URL routing — v2 shape.
//
// The URL is a reflection of activeWorkspaceId, not a separate source of
// truth. Two-way sync between window.location and store state happens in
// useUrlSync(), mounted once near the top of the tree (App.tsx).
//
//   /                  → empty / no project active
//   /projects/:id      → that project's workspace is active

import { useEffect, useRef } from "react";
import { useStore } from "./state/store";
import type { WorkspaceId } from "./types";

export type ParsedRoute =
  | { kind: "empty" }
  | { kind: "project"; projectId: string }
  | { kind: "not-found" };

export function parsePath(pathname: string): ParsedRoute {
  if (pathname === "/" || pathname === "") return { kind: "empty" };
  const projectMatch = pathname.match(/^\/projects\/([^/]+)\/?$/);
  if (projectMatch) return { kind: "project", projectId: projectMatch[1] };
  return { kind: "not-found" };
}

export function pathForWorkspace(workspaceId: WorkspaceId | null): string {
  if (!workspaceId) return "/";
  const projectId = workspaceId.slice("project:".length);
  return `/projects/${projectId}`;
}

/**
 * Mount once inside the store context (in App.tsx). Three jobs:
 *   1. On mount, reconcile URL with persisted state — if URL is /projects/:id,
 *      ensure that workspace is open + active.
 *   2. On activeWorkspaceId change, push the corresponding URL.
 *   3. On browser back/forward (popstate), switch active workspace from URL.
 */
export function useUrlSync(): void {
  const { state, openProject, switchToProject } = useStore();

  // Initial reconciliation — runs once.
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (reconciledRef.current) return;
    reconciledRef.current = true;
    const route = parsePath(window.location.pathname);
    if (route.kind === "project") {
      openProject(route.projectId);
    }
    // empty / not-found → leave URL alone; activeWorkspaceId effect will
    // push the canonical path on next state change.
  }, [openProject]);

  // Push URL whenever activeWorkspaceId changes.
  const lastPushedRef = useRef<string | null>(null);
  useEffect(() => {
    const target = pathForWorkspace(state.activeWorkspaceId);
    if (window.location.pathname === target) return;
    if (lastPushedRef.current === target) return;
    lastPushedRef.current = target;
    window.history.pushState(null, "", target);
  }, [state.activeWorkspaceId]);

  // Popstate (back/forward) → re-derive active workspace from URL.
  useEffect(() => {
    const onPop = () => {
      const route = parsePath(window.location.pathname);
      if (route.kind === "project") {
        // If the workspace is already open, just switch; else open it.
        switchToProject(route.projectId);
        // Fallback to open if switch didn't find a matching workspace.
        // (switch is a no-op when the workspace isn't open.)
        const existing = state.workspaces.some(
          (w) => w.projectId === route.projectId,
        );
        if (!existing) openProject(route.projectId);
      }
      // empty → don't force-close anything; user can close from UI.
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [openProject, switchToProject, state.workspaces]);
}
