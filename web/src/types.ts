// Mirror of the public API surface from the Worker. CamelCase throughout.
//
// v3 (run #10): GitHub IS the project list. Project rows are minimum chat
// plumbing — `id`, `repoFullName`, `cloneUrl`, `createdAt`. The picker reads
// the merged repo list (GitHub × D1) on demand; the store only tracks
// workspaces (open projects).

export type Signal =
  | "progress"
  | "blocked"
  | "stalled"
  | "done"
  | "needs_attention";

// ── Projects (v3 minimal shape) ──────────────────────────────────────

/** A claimed repo. The D1 row carries no substantive memory; `.ceo/*` does. */
export interface ProjectListItem {
  id: string;
  repoFullName: string;
  cloneUrl: string;
  createdAt: string;
}

// ── Repos (GitHub × D1 merged for the picker) ───────────────────────

/** A repo on the user's GitHub account, plus the D1 isProject overlay. */
export interface RepoListItem {
  name: string;
  fullName: string;
  description: string | null;
  cloneUrl: string;
  htmlUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
  updatedAt: string;
  isProject: boolean;
  projectId: string | null; // populated when isProject is true
}

// ── Claim / create-new responses ────────────────────────────────────

export interface ClaimResult {
  projectId: string;
  repoFullName: string;
  cloneUrl: string;
  isNew: boolean;
  /** Surfaced as a warning when the scaffold pass failed mid-flight. */
  scaffoldingError?: string;
  scaffoldingPartial?: boolean;
  alreadyHadCeoDirectory?: boolean;
}

// ── Chats ───────────────────────────────────────────────────────────

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

export interface ManagerChatResolve {
  chatId: string;
  projectId: string;
  created: boolean;
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

// ── Dropnotes ───────────────────────────────────────────────────────

export interface Dropnote {
  id: string;
  content: string;
  createdAt: string;
  archivedAt: string | null;
}

// ── Workspaces (v3) ─────────────────────────────────────────────────
//
// A workspace = an open project. `repoFullName` is denormalized into the
// workspace state (and persisted to localStorage) so panes can render the
// project name without a round-trip on reload.

export type WorkspaceId = `project:${string}`;

export interface WorkspaceState {
  id: WorkspaceId;
  projectId: string;
  repoFullName: string;
  managerChatId: string | null;
  minimized: boolean;
  lastInteractionAt: number;
  hasUnread: boolean;
}

export function workspaceIdForProject(projectId: string): WorkspaceId {
  return `project:${projectId}` as WorkspaceId;
}

export function projectIdFromWorkspaceId(id: WorkspaceId): string {
  return id.slice("project:".length);
}
