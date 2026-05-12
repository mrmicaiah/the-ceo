// Global app state — v3 shape.
//
// v3 (run #10): `state.projects` is gone. The picker fetches its own data
// from /api/repos on demand. The store only tracks open workspaces and
// which one is active.
//
// A workspace IS a project; the manager's chat is the workspace's content.
// `repoFullName` is denormalized into the workspace state so panes can
// render a label without round-tripping on reload.
//
// Actions:
//   OPEN_PROJECT(id, repoFullName)  — ensure a workspace exists, activate
//   CLOSE_PROJECT(id)               — remove the workspace
//   SWITCH_TO_PROJECT(id)           — focus existing; restore if minimized
//   MINIMIZE_PROJECT(id)            — send to top-bar chip
//   RESTORE_PROJECT(id)             — bring back to the grid
//   SET_MANAGER_CHAT_ID(id, chatId) — cache the resolved chatId
//   TOUCH_PROJECT(id)               — bump LRU
//   MARK_READ(id) / MARK_UNREAD(id) — notification dot bookkeeping

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
import { loadWorkspaceState, persistWorkspaceState } from "../lib/storage";
import type { WorkspaceId, WorkspaceState } from "../types";
import { workspaceIdForProject } from "../types";

interface AppState {
  workspaces: WorkspaceState[];
  activeWorkspaceId: WorkspaceId | null;
}

type Action =
  | {
      type: "workspace/open";
      projectId: string;
      repoFullName: string;
    }
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
    case "workspace/open": {
      const id = workspaceIdForProject(action.projectId);
      const now = Date.now();
      const existing = state.workspaces.find((w) => w.id === id);
      if (existing) {
        const updated = state.workspaces.map((w) =>
          w.id === id
            ? {
                ...w,
                minimized: false,
                lastInteractionAt: now,
                hasUnread: false,
                // Refresh in case it was previously empty on reload.
                repoFullName: action.repoFullName,
              }
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
        repoFullName: action.repoFullName,
        managerChatId: null,
        minimized: false,
        lastInteractionAt: now,
        hasUnread: false,
      };
      return enforceVisibleCap(
        { ...state, workspaces: [...state.workspaces, fresh], activeWorkspaceId: id },
        id,
      );
    }

    case "workspace/close": {
      const id = workspaceIdForProject(action.projectId);
      const filtered = state.workspaces.filter((w) => w.id !== id);
      let nextActive: WorkspaceId | null = state.activeWorkspaceId;
      if (state.activeWorkspaceId === id) {
        const candidates = filtered
          .filter((w) => !w.minimized)
          .sort((a, b) => b.lastInteractionAt - a.lastInteractionAt);
        nextActive = candidates[0]?.id ?? null;
      }
      return { ...state, workspaces: filtered, activeWorkspaceId: nextActive };
    }

    case "workspace/switch": {
      const id = workspaceIdForProject(action.projectId);
      if (!state.workspaces.find((w) => w.id === id)) return state;
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
          w.id === id && w.minimized ? { ...w, hasUnread: true } : w,
        ),
      };
    }

    default:
      return state;
  }
}

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
  openProject: (projectId: string, repoFullName: string) => void;
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
      workspaces: persisted.workspaces,
      activeWorkspaceId: persisted.activeWorkspaceId,
    } satisfies AppState;
  });

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

  const openProject = useCallback((projectId: string, repoFullName: string) => {
    dispatch({ type: "workspace/open", projectId, repoFullName });
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
