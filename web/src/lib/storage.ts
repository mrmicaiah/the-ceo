// localStorage helpers. v2 shape — workspaces are projects (no "ceo"
// workspace, no openChats[]).

import type { WorkspaceId, WorkspaceState } from "../types";

// ── Claude Code dispatch jobIds ──────────────────────────────────────
//
// (sourceChatId, summary-hash, prompt-hash) → jobId, so reload after dispatch
// shows the running/completed panel instead of the idle "Run Claude Code →"
// affordance. Per-browser only.

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
// v2 shape — workspaces are projects. Stored as a single JSON blob.

// v3 (run #10): workspace state gained `repoFullName`. New key forces a
// reset on first load for anyone holding v2 state.
const WORKSPACE_KEY = "theceo.workspaceState.v3";

export interface PersistedWorkspaceState {
  workspaces: WorkspaceState[];
  activeWorkspaceId: WorkspaceId | null;
}

export function loadWorkspaceState(): PersistedWorkspaceState {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return defaultWorkspaceState();
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidWorkspaceState(parsed)) {
      console.warn("[workspace] persisted v2 state failed validation; resetting");
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
  return { workspaces: [], activeWorkspaceId: null };
}

function isValidWorkspaceState(v: unknown): v is PersistedWorkspaceState {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  if (!Array.isArray(obj.workspaces)) return false;
  if (obj.activeWorkspaceId !== null && typeof obj.activeWorkspaceId !== "string") {
    return false;
  }
  for (const w of obj.workspaces) {
    if (!w || typeof w !== "object") return false;
    const ws = w as Record<string, unknown>;
    if (typeof ws.id !== "string" || !ws.id.startsWith("project:")) return false;
    if (typeof ws.projectId !== "string") return false;
    if (typeof ws.repoFullName !== "string") return false;
    if (ws.managerChatId !== null && typeof ws.managerChatId !== "string") return false;
    if (typeof ws.minimized !== "boolean") return false;
    if (typeof ws.lastInteractionAt !== "number") return false;
    if (typeof ws.hasUnread !== "boolean") return false;
  }
  return true;
}
