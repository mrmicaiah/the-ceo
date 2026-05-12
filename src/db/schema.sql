-- The CEO — D1 Schema (v3)
--
-- v3 (run #10): GitHub is the project list. The `projects` table is now
-- minimum chat plumbing — one row per claimed repo, holding only the
-- identifying tuple. The substantive project memory (goal, context,
-- decisions, current state) lives in `.ceo/*.md` files committed to the
-- repo itself; the manager reads those on every chat turn.
--
-- v3 retirements from v2: the `briefings` table is gone. Its job moved to
-- `.ceo/goal.md`, `.ceo/context.md`, `.ceo/decisions.md`, `.ceo/board.md`
-- in each project's repo.
--
-- Legacy v1 columns (reports/status_pings tables, chats.employee_id,
-- chats.parent_chat_id) are still preserved structurally with no data —
-- they may return if wrap/handoff are re-enabled.

-- ── Projects ───────────────────────────────────────────────────────
-- One row per claimed repo. The full name (`owner/repo`) is the unique
-- key; clone_url is what the agent needs to actually fetch the code.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  repo_full_name TEXT NOT NULL UNIQUE,
  clone_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_repo_full_name ON projects(repo_full_name);

-- ── Chats ──────────────────────────────────────────────────────────
-- v3: one chat per project (the manager's conversation). employee_id and
-- parent_chat_id are preserved as nullable columns for backward shape;
-- v3 writes leave them NULL. The CHECK fires only when a value is set.

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
-- manager_seen_at = "the manager hasn't reviewed this terminal job yet"

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

-- ── Reports / pings (legacy v1, preserved structurally — unused in v3) ─

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

-- ── Dropnotes ──────────────────────────────────────────────────────
-- v2-introduced; v3 preserves data and shape. The user's stray-thought
-- stream. Not tied to a project.

CREATE TABLE IF NOT EXISTS dropnotes (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dropnotes_unarchived ON dropnotes(archived_at, created_at);
