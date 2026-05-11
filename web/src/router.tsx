// Hand-rolled router. We only have two real routes — home (CEO chat) and
// employee chats — so React Router would be overkill. This gives us URL-based
// navigation, browser back/forward, and a tiny API.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Route =
  | { kind: "home" }
  | { kind: "employee-chat"; projectId: string; chatId: string }
  | { kind: "not-found" };

interface RouterCtx {
  pathname: string;
  route: Route;
  navigate: (path: string) => void;
}

const RouterContext = createContext<RouterCtx | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [pathname, setPathname] = useState(() => window.location.pathname || "/");

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname || "/");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((path: string) => {
    if (path === window.location.pathname) return;
    window.history.pushState(null, "", path);
    setPathname(path);
  }, []);

  const value = useMemo<RouterCtx>(
    () => ({ pathname, navigate, route: matchRoute(pathname) }),
    [pathname, navigate],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterCtx {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used inside RouterProvider");
  return ctx;
}

function matchRoute(pathname: string): Route {
  if (pathname === "/" || pathname === "") return { kind: "home" };
  const m = pathname.match(/^\/projects\/([^/]+)\/chat\/([^/]+)\/?$/);
  if (m) return { kind: "employee-chat", projectId: m[1], chatId: m[2] };
  return { kind: "not-found" };
}

export function pathForEmployeeChat(projectId: string, chatId: string): string {
  return `/projects/${projectId}/chat/${chatId}`;
}
