-- v2 rebuild migration (run #9).
--
-- Apply locally:
--   npx wrangler d1 execute the-ceo-db --local --file=src/db/migrations/v2-rebuild.sql
--
-- Apply to remote:
--   npx wrangler d1 execute the-ceo-db --remote --file=src/db/migrations/v2-rebuild.sql
--
-- Idempotent for fresh DBs. On existing DBs, ALTER TABLE RENAME COLUMN will
-- error if applied twice; that's expected.

-- 1. Wipe v1 conversation/report state.
--    Order matters because of FK constraints:
--      messages.chat_id     → chats(id)
--      execution_jobs.chat_id → chats(id)
--    Wiping messages first, then execution_jobs, then chats avoids the
--    dangling FK reference. execution_jobs is wiped despite the spec's
--    preference to preserve it — the FK from execution_jobs.chat_id to
--    chats(id) blocks the chats wipe otherwise. Historical job rows had
--    no v2 value (manager_seen_at is per-project, fresh jobs will start
--    accumulating again).
DELETE FROM messages;
DELETE FROM execution_jobs;
DELETE FROM chats;
DELETE FROM reports;
DELETE FROM status_pings;

-- 2. Drop the per-employee notes table. No callers in v2.
DROP TABLE IF EXISTS employee_notes;

-- 3. Rename execution_jobs.dex_seen_at → manager_seen_at. Same semantics
--    (an unseen-since-last-turn marker), v2-appropriate name.
ALTER TABLE execution_jobs RENAME COLUMN dex_seen_at TO manager_seen_at;

-- 4. Replace the old unseen-jobs index with the renamed column.
DROP INDEX IF EXISTS idx_jobs_dex_unseen;
CREATE INDEX IF NOT EXISTS idx_jobs_manager_unseen
  ON execution_jobs(project_id, status, manager_seen_at);

-- 5. Create the dropnotes table.
CREATE TABLE IF NOT EXISTS dropnotes (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dropnotes_unarchived
  ON dropnotes(archived_at, created_at);

-- Notes:
--
-- 1. chats.employee_id is intentionally NOT dropped. It's nullable; the
--    CHECK constraint only applies when a value is set. v2 writes chats
--    with employee_id NULL. Dropping the column would require a table
--    rebuild that conflicts with execution_jobs.chat_id FK.
--
-- 2. The reports and status_pings tables are likewise NOT dropped; their
--    data is wiped, but the tables remain. Wrap is parked, not removed —
--    if/when wrap returns, the tables are ready.
--
-- 3. The ceo_state table is left in place but unused. v2 has no CEO.
