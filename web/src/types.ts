// Mirror of the public API surface from the Worker. CamelCase throughout.

export type EmployeeId = "nora" | "iris" | "theo" | "dex";

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

export interface Report {
  id: string;
  projectId: string;
  fromEmployee: EmployeeId;
  parentNodeId: string | null;
  askedToDo: string;
  whatHappened: string;
  artifact: string | null;
  openQuestions: string | null;
  recommendedNextMove: string;
  createdAt: string;
}

export interface StatusPing {
  projectId: string;
  summary: string;
  signal: Signal;
  createdAt: string;
}

export type ChatStatus = "active" | "wrapped";

export interface ChatWithMessages {
  id: string;
  projectId: string | null;
  employeeId: EmployeeId | null;
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

export interface WrapResult {
  wrapped: true;
  report?: Report;
  briefing?: Briefing;
  ping?: StatusPing | null;
  noReport?: boolean;
  reason?: string;
}

export interface CastResult {
  chatId: string;
  employee: EmployeeId;
  projectId: string;
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
