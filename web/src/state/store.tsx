// Global app state — projects list, workspaces (run #7), CEO chat id.
//
// Briefings are NO LONGER global; each project workspace owns its own briefing
// state locally. A custom DOM event ("ceo:briefing-updated") notifies open
// workspaces when the CEO's update_briefing action fires for their project.

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
  defaultWorkspaceState,
  getOrCreateCeoChatId,
  loadWorkspaceState,
  persistWorkspaceState,
} from "../lib/storage";
import type {
  EmployeeId,
  OpenChat,
  ProjectListItem,
  WorkspaceId,
  WorkspaceState,
} from "../types";
import { workspaceIdForProject } from "../types";

interface AppState {
  projects: ProjectListItem[];
  projectsLoading: boolean;
  projectsError: string | null;
  ceoChatId: string;
  workspaces: WorkspaceState[]; // ordered; "ceo" is always first
  activeWorkspaceId: WorkspaceId;
}

type Action =
  // Project list mutations (carried over from prior runs)
  | { type: "projects/loaded"; projects: ProjectListItem[] }
  | { type: "projects/error"; error: string }
  | { type: "projects/added"; project: ProjectListItem }
  | { type: "projects/updated"; project: ProjectListItem }
  // Workspace lifecycle
  | { type: "workspace/open"; projectId: string; activate?: boolean }
  | { type: "workspace/close"; projectId: string }
  | { type: "workspace/switch"; workspaceId: WorkspaceId }
  | { type: "workspace/toggleBriefing"; workspaceId: WorkspaceId }
  // Chat lifecycle within a workspace
  | {
      type: "chat/open";
      workspaceId: WorkspaceId;
      chatId: string;
      employeeId: EmployeeId;
      label: string;
    }
  | { type: "chat/minimize"; workspaceId: WorkspaceId; chatId: string }
  | { type: "chat/restore"; workspaceId: WorkspaceId; chatId: string }
  | { type: "chat/close"; workspaceId: WorkspaceId; chatId: string }
  | { type: "chat/touch"; workspaceId: WorkspaceId; chatId: string };

const MAX_VISIBLE_CHATS = 4;

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    // ── Projects ────────────────────────────────────────────────────
    case "projects/loaded":
      return {
        ...state,
        projects: action.projects,
        projectsLoading: false,
        projectsError: null,
      };
    case "projects/error":
      return { ...state, projectsLoading: false, projectsError: action.error };
    case "projects/added":
      return {
        ...state,
        projects: [
          action.project,
          ...state.projects.filter((p) => p.id !== action.project.id),
        ],
      };
    case "projects/updated":
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.project.id ? action.project : p,
        ),
      };

    // ── Workspace lifecycle ─────────────────────────────────────────
    case "workspace/open": {
      const id = workspaceIdForProject(action.projectId);
      const exists = state.workspaces.some((w) => w.id === id);
      const nextWorkspaces = exists
        ? state.workspaces
        : [
            ...state.workspaces,
            {
              id,
              projectId: action.projectId,
              openChats: [],
              briefingCollapsed: false,
            } satisfies WorkspaceState,
          ];
      return {
        ...state,
        workspaces: nextWorkspaces,
        activeWorkspaceId: action.activate === false ? state.activeWorkspaceId : id,
      };
    }
    case "workspace/close": {
      const id = workspaceIdForProject(action.projectId);
      const filtered = state.workspaces.filter((w) => w.id !== id);
      // If we just closed the active workspace, fall back to CEO.
      const nextActive: WorkspaceId =
        state.activeWorkspaceId === id ? "ceo" : state.activeWorkspaceId;
      return { ...state, workspaces: filtered, activeWorkspaceId: nextActive };
    }
    case "workspace/switch":
      return { ...state, activeWorkspaceId: action.workspaceId };
    case "workspace/toggleBriefing":
      return updateWorkspace(state, action.workspaceId, (ws) => ({
        ...ws,
        briefingCollapsed: !ws.briefingCollapsed,
      }));

    // ── Chat lifecycle ──────────────────────────────────────────────
    case "chat/open": {
      return updateWorkspace(state, action.workspaceId, (ws) => {
        const existing = ws.openChats.find((c) => c.chatId === action.chatId);
        const now = Date.now();
        if (existing) {
          // Already in the workspace — just promote to visible + bump.
          const updated = ws.openChats.map((c) =>
            c.chatId === action.chatId
              ? { ...c, visible: true, lastInteractionAt: now }
              : c,
          );
          return enforceVisibleCap({ ...ws, openChats: updated });
        }
        const newChat: OpenChat = {
          chatId: action.chatId,
          employeeId: action.employeeId,
          label: action.label,
          visible: true,
          lastInteractionAt: now,
        };
        return enforceVisibleCap({
          ...ws,
          openChats: [...ws.openChats, newChat],
        });
      });
    }
    case "chat/minimize":
      return updateWorkspace(state, action.workspaceId, (ws) => ({
        ...ws,
        openChats: ws.openChats.map((c) =>
          c.chatId === action.chatId ? { ...c, visible: false } : c,
        ),
      }));
    case "chat/restore":
      return updateWorkspace(state, action.workspaceId, (ws) => {
        const now = Date.now();
        const updated = ws.openChats.map((c) =>
          c.chatId === action.chatId
            ? { ...c, visible: true, lastInteractionAt: now }
            : c,
        );
        return enforceVisibleCap({ ...ws, openChats: updated });
      });
    case "chat/close":
      return updateWorkspace(state, action.workspaceId, (ws) => ({
        ...ws,
        openChats: ws.openChats.filter((c) => c.chatId !== action.chatId),
      }));
    case "chat/touch":
      return updateWorkspace(state, action.workspaceId, (ws) => ({
        ...ws,
        openChats: ws.openChats.map((c) =>
          c.chatId === action.chatId
            ? { ...c, lastInteractionAt: Date.now() }
            : c,
        ),
      }));

    default:
      return state;
  }
}

function updateWorkspace(
  state: AppState,
  workspaceId: WorkspaceId,
  fn: (ws: WorkspaceState) => WorkspaceState,
): AppState {
  return {
    ...state,
    workspaces: state.workspaces.map((w) => (w.id === workspaceId ? fn(w) : w)),
  };
}

/**
 * If more than MAX_VISIBLE_CHATS chats are visible, auto-minimize the one
 * with the oldest `lastInteractionAt`. Always called after any operation
 * that could push visibility above the cap (open / restore).
 */
function enforceVisibleCap(ws: WorkspaceState): WorkspaceState {
  const visible = ws.openChats.filter((c) => c.visible);
  if (visible.length <= MAX_VISIBLE_CHATS) return ws;
  let oldest = visible[0];
  for (const c of visible) {
    if (c.lastInteractionAt < oldest.lastInteractionAt) oldest = c;
  }
  return {
    ...ws,
    openChats: ws.openChats.map((c) =>
      c.chatId === oldest.chatId ? { ...c, visible: false } : c,
    ),
  };
}

interface StoreCtx {
  state: AppState;
  refreshProjects: () => Promise<void>;
  addProject: (project: ProjectListItem) => void;
  updateProjectLocal: (project: ProjectListItem) => void;
  // Workspace actions
  openWorkspace: (projectId: string, activate?: boolean) => void;
  closeWorkspace: (projectId: string) => void;
  switchWorkspace: (workspaceId: WorkspaceId) => void;
  toggleBriefing: (workspaceId: WorkspaceId) => void;
  // Chat actions
  openChat: (input: {
    workspaceId: WorkspaceId;
    chatId: string;
    employeeId: EmployeeId;
    label: string;
  }) => void;
  minimizeChat: (workspaceId: WorkspaceId, chatId: string) => void;
  restoreChat: (workspaceId: WorkspaceId, chatId: string) => void;
  closeChat: (workspaceId: WorkspaceId, chatId: string) => void;
  touchChat: (workspaceId: WorkspaceId, chatId: string) => void;
}

const StoreContext = createContext<StoreCtx | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const persisted = loadWorkspaceState();
    return {
      projects: [],
      projectsLoading: true,
      projectsError: null,
      ceoChatId: getOrCreateCeoChatId(),
      workspaces: persisted.workspaces,
      activeWorkspaceId: persisted.activeWorkspaceId,
    } satisfies AppState;
  });

  // Debounced persistence: every workspace/chat change writes a single
  // localStorage blob after a quiet period.
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
  const openWorkspace = useCallback((projectId: string, activate?: boolean) => {
    dispatch({ type: "workspace/open", projectId, activate });
  }, []);
  const closeWorkspace = useCallback((projectId: string) => {
    dispatch({ type: "workspace/close", projectId });
  }, []);
  const switchWorkspace = useCallback((workspaceId: WorkspaceId) => {
    dispatch({ type: "workspace/switch", workspaceId });
  }, []);
  const toggleBriefing = useCallback((workspaceId: WorkspaceId) => {
    dispatch({ type: "workspace/toggleBriefing", workspaceId });
  }, []);
  const openChat = useCallback(
    (input: {
      workspaceId: WorkspaceId;
      chatId: string;
      employeeId: EmployeeId;
      label: string;
    }) => {
      dispatch({ type: "chat/open", ...input });
    },
    [],
  );
  const minimizeChat = useCallback((workspaceId: WorkspaceId, chatId: string) => {
    dispatch({ type: "chat/minimize", workspaceId, chatId });
  }, []);
  const restoreChat = useCallback((workspaceId: WorkspaceId, chatId: string) => {
    dispatch({ type: "chat/restore", workspaceId, chatId });
  }, []);
  const closeChat = useCallback((workspaceId: WorkspaceId, chatId: string) => {
    dispatch({ type: "chat/close", workspaceId, chatId });
  }, []);
  const touchChat = useCallback((workspaceId: WorkspaceId, chatId: string) => {
    dispatch({ type: "chat/touch", workspaceId, chatId });
  }, []);

  const value = useMemo<StoreCtx>(
    () => ({
      state,
      refreshProjects,
      addProject,
      updateProjectLocal,
      openWorkspace,
      closeWorkspace,
      switchWorkspace,
      toggleBriefing,
      openChat,
      minimizeChat,
      restoreChat,
      closeChat,
      touchChat,
    }),
    [
      state,
      refreshProjects,
      addProject,
      updateProjectLocal,
      openWorkspace,
      closeWorkspace,
      switchWorkspace,
      toggleBriefing,
      openChat,
      minimizeChat,
      restoreChat,
      closeChat,
      touchChat,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreCtx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside AppStoreProvider");
  return ctx;
}

// Defaults exported for tests / debugging.
export { defaultWorkspaceState };
