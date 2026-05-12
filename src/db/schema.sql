-- The CEO — D1 Schema
--
-- v2 retires named specialists, the CEO surface, and the wrap/report flow.
-- The schema here reflects the v2 state; legacy v1-shape columns (e.g.,
-- chats.employee_id, the reports/status_pings tables) are intentionally
-- preserved as nullable / empty so the migration is non-destructive at the
-- structural level. v2 writes do not populate them.

-- ── Projects ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dormant', 'archived')),
  repo_path TEXT,
  clone_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Briefings (one per project, current snapshot) ──────────────────

CREATE TABLE IF NOT EXISTS briefings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  goal TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  next_move TEXT NOT NULL DEFAULT '',
  why TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Chats ──────────────────────────────────────────────────────────
-- v2: one chat per project (the manager's conversation). employee_id is
-- preserved as a nullable column for backward shape; v2 writes leave it
-- NULL. The CHECK fires only when a value is set, so this remains valid.

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  employee_id TEXT CHECK (employee_id IN ('nora', 'iris', 'theo', 'dex')),
  parent_chat_id TEXT REFERENCES chats(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'wrapped')),
  task_brief TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Messages ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);

-- ── Execution jobs ─────────────────────────────────────────────────
-- manager_seen_at (was dex_seen_at in v1) — "the manager hasn't reviewed
-- this terminal job yet" marker. Same semantics, renamed for v2.

CREATE TABLE IF NOT EXISTS execution_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  chat_id TEXT NOT NULL REFERENCES chats(id),
  prompt TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  output_stream TEXT,
  diff_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  manager_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_project_status ON execution_jobs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_manager_unseen ON execution_jobs(project_id, status, manager_seen_at);

-- ── Reports / pings (legacy, preserved structurally — unused in v2) ─
-- Wrap is parked, not removed. These tables remain in case wrap returns.

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  from_employee TEXT NOT NULL CHECK (from_employee IN ('nora', 'iris', 'theo', 'dex')),
  parent_node_id TEXT,
  asked_to_do TEXT NOT NULL,
  what_happened TEXT NOT NULL,
  artifact TEXT,
  open_questions TEXT,
  recommended_next_move TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS status_pings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  summary TEXT NOT NULL,
  signal TEXT NOT NULL CHECK (signal IN ('progress', 'blocked', 'stalled', 'done', 'needs_attention')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Dropnotes (v2) ─────────────────────────────────────────────────
-- The user's stray-thought stream. Not tied to a project; surfaced through
-- the always-on dropnote box at bottom-left of the app.

CREATE TABLE IF NOT EXISTS dropnotes (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dropnotes_unarchived ON dropnotes(archived_at, created_at);
