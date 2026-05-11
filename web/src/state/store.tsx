// Global app state — projects list, current briefing (only relevant on a
// project chat view), and the CEO chat id. Messages live in local component
// state of ChatView, fetched fresh on mount.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { listProjects } from "../lib/api";
import { getOrCreateCeoChatId } from "../lib/storage";
import type { Briefing, ProjectListItem } from "../types";

interface State {
  projects: ProjectListItem[];
  projectsLoading: boolean;
  projectsError: string | null;
  ceoChatId: string;
  // Briefing shown in the right rail when on a project chat. Owned here so
  // that wrap-chat in ChatView can update it and RightRail re-renders.
  currentBriefing: Briefing | null;
  // ID of the project the current briefing belongs to — lets BriefingUpdateNote
  // know whether to refresh the right rail in-place.
  currentBriefingProjectId: string | null;
}

type Action =
  | { type: "projects/loaded"; projects: ProjectListItem[] }
  | { type: "projects/error"; error: string }
  | { type: "projects/added"; project: ProjectListItem }
  | { type: "projects/updated"; project: ProjectListItem }
  | { type: "briefing/set"; briefing: Briefing | null; projectId: string | null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
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
      // Newest project first, matching the GET /api/projects ordering.
      return {
        ...state,
        projects: [
          action.project,
          ...state.projects.filter((p) => p.id !== action.project.id),
        ],
      };
    case "projects/updated":
      // In-place update preserves rail order — the project doesn't jump just
      // because its name or repo path changed.
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.project.id ? action.project : p,
        ),
      };
    case "briefing/set":
      return {
        ...state,
        currentBriefing: action.briefing,
        currentBriefingProjectId: action.projectId,
      };
    default:
      return state;
  }
}

interface StoreCtx {
  state: State;
  refreshProjects: () => Promise<void>;
  addProject: (project: ProjectListItem) => void;
  updateProjectLocal: (project: ProjectListItem) => void;
  setBriefing: (briefing: Briefing | null, projectId: string | null) => void;
}

const StoreContext = createContext<StoreCtx | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    projects: [],
    projectsLoading: true,
    projectsError: null,
    ceoChatId: getOrCreateCeoChatId(),
    currentBriefing: null,
    currentBriefingProjectId: null,
  }));

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

  const setBriefing = useCallback(
    (briefing: Briefing | null, projectId: string | null) => {
      dispatch({ type: "briefing/set", briefing, projectId });
    },
    [],
  );

  const value = useMemo<StoreCtx>(
    () => ({
      state,
      refreshProjects,
      addProject,
      updateProjectLocal,
      setBriefing,
    }),
    [state, refreshProjects, addProject, updateProjectLocal, setBriefing],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreCtx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside AppStoreProvider");
  return ctx;
}
