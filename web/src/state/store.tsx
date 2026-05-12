// Global app state — v2 shape.
//
// A workspace IS a project. There's no per-chat openChats; each workspace's
// content is the manager's conversation for that project. Visibility is per
// workspace (minimized → top-bar chip), not per chat.
//
// Actions:
//   OPEN_PROJECT           — ensure a workspace exists for this project,
//                            activate it (focus + ensure visible)
//   CLOSE_PROJECT          — remove the workspace entirely
//   SWITCH_TO_PROJECT      — focus existing workspace; restore if minimized
//   MINIMIZE_PROJECT       — send a visible workspace to the top bar
//   RESTORE_PROJECT        — bring a minimized workspace back into the grid
//   SET_MANAGER_CHAT_ID    — cache the resolved manager chatId
//   TOUCH_PROJECT          — bump lastInteractionAt (LRU bookkeeping)
//   MARK_READ              — clear the notification dot when activated
//   MARK_UNREAD            — set the dot when activity hits a minimized ws

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { listProjects } from "../lib/api";
import {
  loadWorkspaceState,
  persistWorkspaceState,
} from "../lib/storage";
import type {
  ProjectListItem,
  WorkspaceId,
  WorkspaceState,
} from "../types";
import { workspaceIdForProject } from "../types";

interface AppState {
  projects: ProjectListItem[];
  projectsLoading: boolean;
  projectsError: string | null;
  workspaces: WorkspaceState[]; // one per open project
  activeWorkspaceId: WorkspaceId | null; // null = empty state (no project open)
}

type Action =
  | { type: "projects/loaded"; projects: ProjectListItem[] }
  | { type: "projects/error"; error: string }
  | { type: "projects/added"; project: ProjectListItem }
  | { type: "projects/updated"; project: ProjectListItem }
  | { type: "workspace/open"; projectId: string }
  | { type: "workspace/close"; projectId: string }
  | { type: "workspace/switch"; projectId: string }
  | { type: "workspace/minimize"; projectId: string }
  | { type: "workspace/restore"; projectId: string }
  | { type: "workspace/setChatId"; projectId: string; chatId: string }
  | { type: "workspace/touch"; projectId: string }
  | { type: "workspace/markRead"; projectId: string }
  | { type: "workspace/markUnread"; projectId: string };

const MAX_VISIBLE = 4;

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "projects/loaded":
      return { ...state, projects: action.projects, projectsLoading: false, projectsError: null };
    case "projects/error":
      return { ...state, projectsLoading: false, projectsError: action.error };
    case "projects/added":
      return {
        ...state,
        projects: [action.project, ...state.projects.filter((p) => p.id !== action.project.id)],
      };
    case "projects/updated":
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.project.id ? action.project : p,
        ),
      };

    case "workspace/open": {
      const id = workspaceIdForProject(action.projectId);
      const now = Date.now();
      const existing = state.workspaces.find((w) => w.id === id);
      if (existing) {
        // Already open — promote to visible, touch, focus, clear unread.
        const updated = state.workspaces.map((w) =>
          w.id === id
            ? { ...w, minimized: false, lastInteractionAt: now, hasUnread: false }
            : w,
        );
        return enforceVisibleCap(
          { ...state, workspaces: updated, activeWorkspaceId: id },
          id,
        );
      }
      const fresh: WorkspaceState = {
        id,
        projectId: action.projectId,
        managerChatId: null,
        minimized: false,
        lastInteractionAt: now,
        hasUnread: false,
      };
      return enforceVisibleCap(
        {
          ...state,
          workspaces: [...state.workspaces, fresh],
          activeWorkspaceId: id,
        },
        id,
      );
    }

    case "workspace/close": {
      const id = workspaceIdForProject(action.projectId);
      const filtered = state.workspaces.filter((w) => w.id !== id);
      let nextActive: WorkspaceId | null = state.activeWorkspaceId;
      if (state.activeWorkspaceId === id) {
        // Fall back to the most recently touched visible workspace; else null.
        const candidates = filtered
          .filter((w) => !w.minimized)
          .sort((a, b) => b.lastInteractionAt - a.lastInteractionAt);
        nextActive = candidates[0]?.id ?? null;
      }
      return { ...state, workspaces: filtered, activeWorkspaceId: nextActive };
    }

    case "workspace/switch": {
      const id = workspaceIdForProject(action.projectId);
      const exists = state.workspaces.find((w) => w.id === id);
      if (!exists) return state;
      const now = Date.now();
      const updated = state.workspaces.map((w) =>
        w.id === id
          ? { ...w, minimized: false, lastInteractionAt: now, hasUnread: false }
          : w,
      );
      return enforceVisibleCap(
        { ...state, workspaces: updated, activeWorkspaceId: id },
        id,
      );
    }

    case "workspace/minimize": {
      const id = workspaceIdForProject(action.projectId);
      const updated = state.workspaces.map((w) =>
        w.id === id ? { ...w, minimized: true } : w,
      );
      // If we minimized the active workspace, pick the next-most-recent visible
      // one as active; otherwise leave as-is.
      let nextActive: WorkspaceId | null = state.activeWorkspaceId;
      if (state.activeWorkspaceId === id) {
        const candidates = updated
          .filter((w) => !w.minimized)
          .sort((a, b) => b.lastInteractionAt - a.lastInteractionAt);
        nextActive = candidates[0]?.id ?? null;
      }
      return { ...state, workspaces: updated, activeWorkspaceId: nextActive };
    }

    case "workspace/restore": {
      const id = workspaceIdForProject(action.projectId);
      const now = Date.now();
      const updated = state.workspaces.map((w) =>
        w.id === id
          ? { ...w, minimized: false, lastInteractionAt: now, hasUnread: false }
          : w,
      );
      return enforceVisibleCap(
        { ...state, workspaces: updated, activeWorkspaceId: id },
        id,
      );
    }

    case "workspace/setChatId": {
      const id = workspaceIdForProject(action.projectId);
      return {
        ...state,
        workspaces: state.workspaces.map((w) =>
          w.id === id ? { ...w, managerChatId: action.chatId } : w,
        ),
      };
    }

    case "workspace/touch": {
      const id = workspaceIdForProject(action.projectId);
      return {
        ...state,
        workspaces: state.workspaces.map((w) =>
          w.id === id ? { ...w, lastInteractionAt: Date.now() } : w,
        ),
      };
    }

    case "workspace/markRead": {
      const id = workspaceIdForProject(action.projectId);
      return {
        ...state,
        workspaces: state.workspaces.map((w) =>
          w.id === id ? { ...w, hasUnread: false } : w,
        ),
      };
    }

    case "workspace/markUnread": {
      const id = workspaceIdForProject(action.projectId);
      return {
        ...state,
        workspaces: state.workspaces.map((w) =>
          // Only flag minimized workspaces — active ones don't need a dot.
          w.id === id && w.minimized ? { ...w, hasUnread: true } : w,
        ),
      };
    }

    default:
      return state;
  }
}

/**
 * If more than MAX_VISIBLE workspaces are visible (not minimized), auto-
 * minimize the oldest one by lastInteractionAt. The just-promoted workspace
 * `protectedId` is exempt from being the victim.
 */
function enforceVisibleCap(state: AppState, protectedId: WorkspaceId): AppState {
  const visible = state.workspaces.filter((w) => !w.minimized);
  if (visible.length <= MAX_VISIBLE) return state;
  const victims = visible
    .filter((w) => w.id !== protectedId)
    .sort((a, b) => a.lastInteractionAt - b.lastInteractionAt);
  const victim = victims[0];
  if (!victim) return state;
  return {
    ...state,
    workspaces: state.workspaces.map((w) =>
      w.id === victim.id ? { ...w, minimized: true } : w,
    ),
  };
}

interface StoreCtx {
  state: AppState;
  refreshProjects: () => Promise<void>;
  addProject: (project: ProjectListItem) => void;
  updateProjectLocal: (project: ProjectListItem) => void;
  openProject: (projectId: string) => void;
  closeProject: (projectId: string) => void;
  switchToProject: (projectId: string) => void;
  minimizeProject: (projectId: string) => void;
  restoreProject: (projectId: string) => void;
  setManagerChatId: (projectId: string, chatId: string) => void;
  touchProject: (projectId: string) => void;
  markRead: (projectId: string) => void;
  markUnread: (projectId: string) => void;
}

const StoreContext = createContext<StoreCtx | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const persisted = loadWorkspaceState();
    return {
      projects: [],
      projectsLoading: true,
      projectsError: null,
      workspaces: persisted.workspaces,
      activeWorkspaceId: persisted.activeWorkspaceId,
    } satisfies AppState;
  });

  // Debounced persistence: every workspace change writes after 250ms idle.
  const persistTimer = useRef<number | null>(null);
  useEffect(() => {
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current);
    }
    persistTimer.current = window.setTimeout(() => {
      persistWorkspaceState({
        workspaces: state.workspaces,
        activeWorkspaceId: state.activeWorkspaceId,
      });
    }, 250);
    return () => {
      if (persistTimer.current !== null) {
        window.clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
    };
  }, [state.workspaces, state.activeWorkspaceId]);

  const refreshProjects = useCallback(async () => {
    try {
      const projects = await listProjects();
      dispatch({ type: "projects/loaded", projects });
    } catch (err) {
      dispatch({ type: "projects/error", error: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  const addProject = useCallback((project: ProjectListItem) => {
    dispatch({ type: "projects/added", project });
  }, []);
  const updateProjectLocal = useCallback((project: ProjectListItem) => {
    dispatch({ type: "projects/updated", project });
  }, []);
  const openProject = useCallback((projectId: string) => {
    dispatch({ type: "workspace/open", projectId });
  }, []);
  const closeProject = useCallback((projectId: string) => {
    dispatch({ type: "workspace/close", projectId });
  }, []);
  const switchToProject = useCallback((projectId: string) => {
    dispatch({ type: "workspace/switch", projectId });
  }, []);
  const minimizeProject = useCallback((projectId: string) => {
    dispatch({ type: "workspace/minimize", projectId });
  }, []);
  const restoreProject = useCallback((projectId: string) => {
    dispatch({ type: "workspace/restore", projectId });
  }, []);
  const setManagerChatId = useCallback((projectId: string, chatId: string) => {
    dispatch({ type: "workspace/setChatId", projectId, chatId });
  }, []);
  const touchProject = useCallback((projectId: string) => {
    dispatch({ type: "workspace/touch", projectId });
  }, []);
  const markRead = useCallback((projectId: string) => {
    dispatch({ type: "workspace/markRead", projectId });
  }, []);
  const markUnread = useCallback((projectId: string) => {
    dispatch({ type: "workspace/markUnread", projectId });
  }, []);

  const value = useMemo<StoreCtx>(
    () => ({
      state,
      refreshProjects,
      addProject,
      updateProjectLocal,
      openProject,
      closeProject,
      switchToProject,
      minimizeProject,
      restoreProject,
      setManagerChatId,
      touchProject,
      markRead,
      markUnread,
    }),
    [
      state,
      refreshProjects,
      addProject,
      updateProjectLocal,
      openProject,
      closeProject,
      switchToProject,
      minimizeProject,
      restoreProject,
      setManagerChatId,
      touchProject,
      markRead,
      markUnread,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreCtx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside AppStoreProvider");
  return ctx;
}
