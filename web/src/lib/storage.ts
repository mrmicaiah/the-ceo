// localStorage helpers.

import type { WorkspaceId, WorkspaceState } from "../types";

const KEY = "theceo.ceoChatId";

export function getOrCreateCeoChatId(): string {
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Fall back to an in-memory id if storage is unavailable.
    return crypto.randomUUID();
  }
}

// ── Claude Code dispatch jobIds ──────────────────────────────────────
//
// When Dex emits a ```dispatch_claude_code block and the user clicks
// "Run Claude Code →", we POST and get back a jobId. We persist the
// (chatId, action-content) → jobId mapping in localStorage so that on
// page reload the affordance morphs straight into the panel for the
// existing job rather than offering to dispatch a new one. Per-browser
// only; that's fine for v0 single-user.

function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function dispatchKey(chatId: string, summary: string, prompt: string): string {
  return `theceo.dispatch.${chatId}.${shortHash(summary)}.${shortHash(prompt)}`;
}

export function rememberDispatchedJobId(
  chatId: string,
  summary: string,
  prompt: string,
  jobId: string,
): void {
  try {
    window.localStorage.setItem(dispatchKey(chatId, summary, prompt), jobId);
  } catch {
    // ignore
  }
}

export function getDispatchedJobId(
  chatId: string,
  summary: string,
  prompt: string,
): string | null {
  try {
    return window.localStorage.getItem(dispatchKey(chatId, summary, prompt));
  } catch {
    return null;
  }
}

// ── Workspace state ─────────────────────────────────────────────────
//
// The workspace shape (which workspaces are open, the order, the active one,
// the open chats per workspace, their visible/minimized state, briefing rail
// collapsed/open) is persisted as a single JSON blob so reloads restore the
// shape of the office, not just the URL.

const WORKSPACE_KEY = "theceo.workspaceState";

export interface PersistedWorkspaceState {
  workspaces: WorkspaceState[];
  activeWorkspaceId: WorkspaceId;
}

export function loadWorkspaceState(): PersistedWorkspaceState {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return defaultWorkspaceState();
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidWorkspaceState(parsed)) {
      console.warn("[workspace] persisted state failed validation; resetting");
      return defaultWorkspaceState();
    }
    return parsed;
  } catch (err) {
    console.warn("[workspace] failed to load persisted state, resetting", err);
    return defaultWorkspaceState();
  }
}

export function persistWorkspaceState(state: PersistedWorkspaceState): void {
  try {
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable; in-memory only.
  }
}

export function defaultWorkspaceState(): PersistedWorkspaceState {
  return {
    workspaces: [
      { id: "ceo", openChats: [], briefingCollapsed: false },
    ],
    activeWorkspaceId: "ceo",
  };
}

function isValidWorkspaceState(v: unknown): v is PersistedWorkspaceState {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  if (!Array.isArray(obj.workspaces)) return false;
  if (typeof obj.activeWorkspaceId !== "string") return false;
  // CEO workspace must be present at index 0.
  const hasCeo = obj.workspaces.some(
    (w) => (w as { id?: unknown })?.id === "ceo",
  );
  if (!hasCeo) return false;
  // Validate each workspace shallowly.
  for (const w of obj.workspaces) {
    if (!w || typeof w !== "object") return false;
    const ws = w as Record<string, unknown>;
    if (typeof ws.id !== "string") return false;
    if (!Array.isArray(ws.openChats)) return false;
    if (typeof ws.briefingCollapsed !== "boolean") return false;
    for (const c of ws.openChats) {
      if (!c || typeof c !== "object") return false;
      const ch = c as Record<string, unknown>;
      if (typeof ch.chatId !== "string") return false;
      if (typeof ch.employeeId !== "string") return false;
      if (typeof ch.label !== "string") return false;
      if (typeof ch.visible !== "boolean") return false;
      if (typeof ch.lastInteractionAt !== "number") return false;
    }
  }
  return true;
}
