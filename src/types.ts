// API/code-level types. CamelCase throughout — the public surface uses
// camelCase. Snake_case appears only in raw SQL strings.
//
// v3 (run #10): GitHub is the project list. Project rows are minimum chat
// plumbing — id, repo full name, clone url, created_at. Substantive project
// memory lives in `.ceo/*.md` files in the repo itself.

// ── Env binding types ──────────────────────────────────────────────

export interface Env {
  DB: D1Database;
  MANAGER_DO: DurableObjectNamespace;
  AGENT_HUB_DO: DurableObjectNamespace;
  // Static-asset binding for the built /web frontend (Cloudflare Workers Assets).
  // Optional so the Worker still compiles when the binding hasn't been added yet
  // to a particular environment.
  ASSETS?: Fetcher;
  // Secret — local: .dev.vars; prod: `npx wrangler secret put ANTHROPIC_API_KEY`
  ANTHROPIC_API_KEY: string;
  // Bearer token required on all /api/* requests. /health and SPA asset
  // requests are exempt.
  AUTH_TOKEN: string;
  // GitHub Personal Access Token (classic or fine-grained with `repo` scope).
  // In v3 the system requires this to even show the project picker — GitHub
  // IS the project list. Endpoints depending on it return 500 if missing.
  GITHUB_TOKEN?: string;
  // Bearer token the local agent uses to authenticate its websocket upgrade
  // against /api/agent/ws. Distinct from AUTH_TOKEN.
  AGENT_TOKEN?: string;
}

// ── Project (v3 shape) ────────────────────────────────────────────

/** A claimed repo. The minimum row needed for chats + dispatch plumbing. */
export interface Project {
  id: string;
  repoFullName: string;
  cloneUrl: string;
  createdAt: string;
}

// ── Chat / Messages ────────────────────────────────────────────────

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

// ── Claude Code execution ─────────────────────────────────────────

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

// ── Dropnotes ─────────────────────────────────────────────────────

export interface Dropnote {
  id: string;
  content: string;
  createdAt: string;
  archivedAt: string | null;
}
