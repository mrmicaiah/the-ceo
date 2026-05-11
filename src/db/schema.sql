-- The CEO — D1 Schema
-- Durable storage for entities that need to survive and be queried.

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

-- ── Reports (append-only log) ──────────────────────────────────────

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

-- ── Status pings ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS status_pings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  summary TEXT NOT NULL,
  signal TEXT NOT NULL CHECK (signal IN ('progress', 'blocked', 'stalled', 'done', 'needs_attention')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Chats ──────────────────────────────────────────────────────────

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
  dex_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_project_status ON execution_jobs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_dex_unseen ON execution_jobs(project_id, status, dex_seen_at);

-- ── Employee notes (private per-employee memory of the user) ───────

CREATE TABLE IF NOT EXISTS employee_notes (
  employee_id TEXT PRIMARY KEY CHECK (employee_id IN ('nora', 'iris', 'theo', 'dex')),
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed one row per employee so notes can be appended without an upsert dance.
INSERT OR IGNORE INTO employee_notes (employee_id, notes) VALUES
  ('nora', ''), ('iris', ''), ('theo', ''), ('dex', '');

-- ── CEO state ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ceo_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  long_term_notes TEXT NOT NULL DEFAULT '',
  pattern_notes TEXT NOT NULL DEFAULT '',
  last_briefing_to_user TEXT NOT NULL DEFAULT '',
  last_user_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
