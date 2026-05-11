// Workspace-aware URL routing.
//
// The URL is a reflection of activeWorkspaceId, not a separate source of
// truth. Two-way sync between window.location and store state happens in
// useUrlSync(), mounted once near the top of the tree (App.tsx).
//
//   /                         → CEO workspace active
//   /projects/:id             → project workspace active
//   /projects/:id/chat/:chatId → deep link: open workspace + ensure chat,
//                                then strip back to /projects/:id

import { useEffect, useRef } from "react";
import { getChat } from "./lib/api";
import { useStore } from "./state/store";
import { workspaceIdForProject, type EmployeeId, type WorkspaceId } from "./types";

export type ParsedRoute =
  | { kind: "ceo" }
  | { kind: "project"; projectId: string }
  | { kind: "project-chat"; projectId: string; chatId: string }
  | { kind: "not-found" };

export function parsePath(pathname: string): ParsedRoute {
  if (pathname === "/" || pathname === "") return { kind: "ceo" };
  const chatMatch = pathname.match(/^\/projects\/([^/]+)\/chat\/([^/]+)\/?$/);
  if (chatMatch) {
    return { kind: "project-chat", projectId: chatMatch[1], chatId: chatMatch[2] };
  }
  const projectMatch = pathname.match(/^\/projects\/([^/]+)\/?$/);
  if (projectMatch) return { kind: "project", projectId: projectMatch[1] };
  return { kind: "not-found" };
}

export function pathForWorkspace(workspaceId: WorkspaceId): string {
  if (workspaceId === "ceo") return "/";
  const projectId = workspaceId.slice("project:".length);
  return `/projects/${projectId}`;
}

/** Legacy helper retained for places that still build chat-deep-link URLs. */
export function pathForEmployeeChat(projectId: string, chatId: string): string {
  return `/projects/${projectId}/chat/${chatId}`;
}

/**
 * Mount once inside both Store and Router contexts (i.e. in App.tsx). Does
 * three things:
 *   1. On mount, reconcile the current URL with persisted workspace state:
 *      - if URL is /projects/:id, ensure that workspace is open + active
 *      - if URL is /projects/:id/chat/:chatId, additionally fetch the chat
 *        and add it to the workspace's openChats, then replace URL to
 *        /projects/:id
 *   2. On activeWorkspaceId change, push the corresponding URL.
 *   3. On browser back/forward (popstate), dispatch a workspace switch.
 */
export function useUrlSync(): void {
  const {
    state,
    openWorkspace,
    switchWorkspace,
    openChat,
  } = useStore();

  // Initial reconciliation only — runs once.
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (reconciledRef.current) return;
    reconciledRef.current = true;
    const route = parsePath(window.location.pathname);
    if (route.kind === "ceo") {
      switchWorkspace("ceo");
      return;
    }
    if (route.kind === "project") {
      openWorkspace(route.projectId, /* activate */ true);
      return;
    }
    if (route.kind === "project-chat") {
      // Deep-link: open the workspace, fetch chat metadata, open the chat,
      // then collapse URL back to /projects/:id.
      const { projectId, chatId } = route;
      openWorkspace(projectId, true);
      void (async () => {
        const chat = await getChat(chatId).catch(() => null);
        if (chat && chat.employeeId) {
          openChat({
            workspaceId: workspaceIdForProject(projectId),
            chatId,
            employeeId: chat.employeeId as EmployeeId,
            label: chat.taskBrief?.trim() || `Chat with ${chat.employeeId}`,
          });
        }
        // Strip the chat segment from the URL so the user's address bar
        // matches the workspace they're now sitting in.
        const cleaned = `/projects/${projectId}`;
        if (window.location.pathname !== cleaned) {
          window.history.replaceState(null, "", cleaned);
        }
      })();
      return;
    }
    // not-found → leave URL alone; activeWorkspaceId effect will steer.
  }, [openWorkspace, switchWorkspace, openChat]);

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
      if (route.kind === "ceo") {
        switchWorkspace("ceo");
      } else if (route.kind === "project") {
        openWorkspace(route.projectId, true);
      } else if (route.kind === "project-chat") {
        openWorkspace(route.projectId, true);
        // Don't re-fetch the chat on every popstate; if user wants to
        // re-open the chat segment, just nav there fresh.
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [openWorkspace, switchWorkspace]);
}
