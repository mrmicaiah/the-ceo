// Workspace-aware URL routing — v3.
//
// The URL is a reflection of activeWorkspaceId, not a separate source of
// truth. Two-way sync between window.location and store state happens in
// useUrlSync(), mounted once near the top of the tree (App.tsx).
//
//   /                  → empty / no project active
//   /projects/:id      → that project's workspace is active
//
// v3 wrinkle: opening a project requires `repoFullName` (denormalized into
// workspace state for the pane header). URL-based opens (deep-link or
// popstate where the workspace isn't already open in memory) fetch the
// project row first to obtain repoFullName, then open.

import { useEffect, useRef } from "react";
import { getProject } from "./lib/api";
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

/** Open a project by fetching its repo full-name first. Silent on 404. */
async function openProjectFromUrl(
  projectId: string,
  openProject: (projectId: string, repoFullName: string) => void,
): Promise<void> {
  try {
    const project = await getProject(projectId);
    openProject(projectId, project.repoFullName);
  } catch {
    // 404 / unauthenticated / network — leave URL stale; the empty-state
    // workspace covers the no-op case.
  }
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
      // If already in persisted workspaces, switch; otherwise fetch + open.
      const existing = state.workspaces.find((w) => w.projectId === route.projectId);
      if (existing) {
        switchToProject(route.projectId);
      } else {
        void openProjectFromUrl(route.projectId, openProject);
      }
    }
    // empty / not-found → leave URL alone; activeWorkspaceId effect will
    // push the canonical path on next state change.
    // (Deliberately uses state.workspaces from the closure; this runs once.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        const existing = state.workspaces.some(
          (w) => w.projectId === route.projectId,
        );
        if (existing) {
          switchToProject(route.projectId);
        } else {
          void openProjectFromUrl(route.projectId, openProject);
        }
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [openProject, switchToProject, state.workspaces]);
}
