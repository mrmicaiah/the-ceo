// API/code-level types. CamelCase throughout — the public surface uses
// camelCase. Snake_case appears only in raw SQL strings against the
// `briefings`, `chats`, `messages`, `execution_jobs`, `dropnotes` tables.
//
// v2: no per-employee identity. One manager per project, addressed by
// projectId.

// ── Env binding types ──────────────────────────────────────────────

export interface Env {
  DB: D1Database;
  PROJECT_DO: DurableObjectNamespace;
  MANAGER_DO: DurableObjectNamespace;
  AGENT_HUB_DO: DurableObjectNamespace;
  // Static-asset binding for the built /web frontend (Cloudflare Workers Assets).
  // Optional so the Worker still compiles when the binding hasn't been added yet
  // to a particular environment.
  ASSETS?: Fetcher;
  // Secret — local: .dev.vars; prod: `npx wrangler secret put ANTHROPIC_API_KEY`
  ANTHROPIC_API_KEY: string;
  // Bearer token required on all /api/* requests. /health and SPA asset
  // requests are exempt. Local: .dev.vars; prod: `npx wrangler secret put AUTH_TOKEN`.
  // The frontend reads VITE_AUTH_TOKEN at build time and sends it as
  // `Authorization: Bearer <token>` — both values must match.
  AUTH_TOKEN: string;
  // GitHub Personal Access Token (classic or fine-grained with "repo" scope).
  // Used by /api/github/create-repo to create repositories on the user's behalf.
  // Local: .dev.vars; prod: `npx wrangler secret put GITHUB_TOKEN`.
  // Optional at the type level so the Worker can start without it; the
  // create-repo endpoint returns a structured 500 when missing.
  GITHUB_TOKEN?: string;
  // Bearer token the local agent uses to authenticate its websocket upgrade
  // against /api/agent/ws. Distinct from AUTH_TOKEN (which gates user-facing
  // /api/* calls). Local: .dev.vars; prod: `npx wrangler secret put AGENT_TOKEN`.
  AGENT_TOKEN?: string;
}

// ── Domain types (camelCase) ───────────────────────────────────────

export type ProjectStatus = "active" | "dormant" | "archived";

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  status: ProjectStatus;
  briefing: Briefing;
  repoPath?: string;
}

export interface Briefing {
  goal: string;
  state: string;
  nextMove: string;
  why: string;
  updatedAt: string;
}

export type ChatStatus = "active" | "wrapped";

export interface Chat {
  id: string;
  projectId: string | null;
  parentChatId: string | null;
  status: ChatStatus;
  taskBrief: string;
  createdAt: string;
}

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface ExecutionJob {
  id: string;
  projectId: string;
  chatId: string;
  prompt: string;
  status: JobStatus;
  outputStream: string | null;
  diffSummary: string | null;
  createdAt: string;
  completedAt: string | null;
}

// ── Dropnotes (v2) ─────────────────────────────────────────────────

export interface Dropnote {
  id: string;
  content: string;
  createdAt: string;
  archivedAt: string | null;
}
