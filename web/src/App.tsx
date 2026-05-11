import { AppShell } from "./components/AppShell";
import { useUrlSync } from "./router";

export function App() {
  // Reconcile URL ↔ workspace state. Mounted here so it lives inside
  // AppStoreProvider (set up in main.tsx).
  useUrlSync();
  return <AppShell />;
}
