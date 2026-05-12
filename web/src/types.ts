// Mirror of the public API surface from the Worker. CamelCase throughout.
//
// v2: no per-employee identity. `EmployeeId`, employee chat metadata, and
// per-chat openChats[] arrays are gone. A workspace is a project; the
// manager's chat is the workspace's content.

export type Signal =
  | "progress"
  | "blocked"
  | "stalled"
  | "done"
  | "needs_attention";

export type ProjectStatus = "active" | "dormant" | "archived";

export interface ProjectListItem {
  id: string;
  name: string;
  status: ProjectStatus;
  repoPath: string | null;
  createdAt: string;
  goal: string;
  state: string;
  nextMove: string;
  why: string;
  briefingUpdatedAt: string;
}

export interface Briefing {
  goal: string;
  state: string;
  nextMove: string;
  why: string;
  updatedAt: string;
}

export type ChatStatus = "active" | "wrapped";

export interface ChatWithMessages {
  id: string;
  projectId: string | null;
  parentChatId: string | null;
  status: ChatStatus;
  taskBrief: string;
  createdAt: string;
  messages: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

// Returned by GET /api/projects/:id/manager-chat — the canonical manager
// chat id for this project. Idempotent: repeated calls return the same id.
export interface ManagerChatResolve {
  chatId: string;
  projectId: string;
  created: boolean;
}

// ── Dropnotes (v2) ───────────────────────────────────────────────────

export interface Dropnote {
  id: string;
  content: string;
  createdAt: string;
  archivedAt: string | null;
}

// ── Claude Code execution ────────────────────────────────────────────

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface JobDiff {
  summary?: string;
  diffStat?: string;
  diff?: string;
  diffTruncated?: boolean;
}

export interface JobFailure {
  error?: string;
  stage?: "workspace" | "execution" | "diff";
}

export interface ExecutionJobSnapshot {
  id: string;
  projectId: string;
  chatId: string;
  summary: string;
  prompt: string;
  status: JobStatus;
  outputStream: string;
  diff: JobDiff | null;
  failure: JobFailure | null;
  createdAt: string;
  completedAt: string | null;
}

export interface DispatchResult {
  jobId: string;
  status: string;
  projectId: string;
}

export type StreamOutputKind = "text" | "tool_use" | "tool_result";

export interface StreamOutputEvent {
  kind: StreamOutputKind;
  payload: string;
}

export interface StreamCompletedEvent {
  summary: string;
  diffStat: string;
  diff: string;
  diffTruncated: boolean;
}

export interface StreamFailedEvent {
  error: string;
  stage: "workspace" | "execution" | "diff";
}

// ── Workspaces (v2) ──────────────────────────────────────────────────
//
// A workspace IS a project. There's no longer a "ceo" workspace and no
// openChats[] within a workspace. The manager chat is the content; we cache
// its chatId in `managerChatId` so reload restores it without a round-trip.
// `lastInteractionAt` and `hasUnread` support the LRU-minimize + notification
// dot semantics for the project dock.

export type WorkspaceId = `project:${string}`;

export interface WorkspaceState {
  id: WorkspaceId;
  projectId: string;
  managerChatId: string | null; // resolved lazily on first open
  minimized: boolean;
  lastInteractionAt: number; // ms since epoch; LRU sort key
  hasUnread: boolean; // notification dot — true when activity on minimized
}

// Helpers used across the frontend.
export function workspaceIdForProject(projectId: string): WorkspaceId {
  return `project:${projectId}` as WorkspaceId;
}

export function projectIdFromWorkspaceId(id: WorkspaceId): string {
  return id.slice("project:".length);
}
