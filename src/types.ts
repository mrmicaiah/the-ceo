// ── Env binding types ──────────────────────────────────────────────

export interface Env {
  DB: D1Database;
  CEO_DO: DurableObjectNamespace;
  PROJECT_DO: DurableObjectNamespace;
  EMPLOYEE_DO: DurableObjectNamespace;
}

// ── Domain types (from data-model.md) ──────────────────────────────

export type ProjectStatus = "active" | "dormant" | "archived";

export interface Project {
  id: string;
  name: string;
  created_at: string;
  status: ProjectStatus;
  briefing: Briefing;
  repo_path?: string;
}

export interface Briefing {
  goal: string;
  state: string;
  next_move: string;
  why: string;
  updated_at: string;
}

export type EmployeeId = "nora" | "iris" | "theo" | "dex";

export interface Employee {
  id: EmployeeId;
  name: string;
  role: string;
  character_sheet: string;
  user_notes: string;
}

export interface Report {
  id: string;
  project_id: string;
  from_employee: EmployeeId;
  parent_node_id?: string;
  asked_to_do: string;
  what_happened: string;
  artifact?: string;
  open_questions?: string;
  recommended_next_move: string;
  created_at: string;
}

export type Signal = "progress" | "blocked" | "stalled" | "done" | "needs_attention";

export interface StatusPing {
  project_id: string;
  summary: string;
  signal: Signal;
  created_at: string;
}

export type ChatStatus = "active" | "wrapped";

export interface Chat {
  id: string;
  project_id?: string;
  employee_id?: EmployeeId;
  parent_chat_id?: string;
  status: ChatStatus;
  task_brief: string;
  messages: Message[];
  created_at: string;
}

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: string;
  chat_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface ExecutionJob {
  id: string;
  project_id: string;
  chat_id: string;
  prompt: string;
  status: JobStatus;
  output_stream?: string;
  diff_summary?: string;
  created_at: string;
  completed_at?: string;
}

export interface CEOState {
  long_term_notes: string;
  pattern_notes: string;
  last_briefing_to_user: string;
  last_user_seen_at: string;
}
