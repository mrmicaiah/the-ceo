-- Run #10: GitHub is the project list. Reshape projects to minimum chat plumbing.

-- Wipe data that referenced the v2 project model.
DELETE FROM execution_jobs;
DELETE FROM messages;
DELETE FROM chats;
DELETE FROM briefings;
DELETE FROM projects;

-- Drop the briefings table — its job moves to .ceo/ files in each repo.
DROP TABLE IF EXISTS briefings;

-- Reshape projects to minimum schema. Since we just emptied it, we can
-- DROP + CREATE without data preservation.
DROP TABLE IF EXISTS projects;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  repo_full_name TEXT NOT NULL UNIQUE,
  clone_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_projects_repo_full_name ON projects(repo_full_name);
