# Run #10 — Scaffold content

This file contains the exact contents Dex needs to copy verbatim into code during run #10. Separated from `run-10-prompt.md` to avoid markdown fence nesting issues in the prompt itself.

---

## Migration SQL

This is the exact content for `src/db/migrations/v3-repos-as-projects.sql`:

~~~sql
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
~~~

---

## Starter file contents

The five string constants exported from `src/lib/ceoScaffold.ts`. Use these contents verbatim (refine wording only by sharpening, never softening).

### CEO_README

This goes in `.ceo/README.md` of every claimed repo:

~~~markdown
# .ceo — Manager's working memory

This directory is the persistent memory for the manager that works on this project. Files here are read by the manager on every session and updated as the project evolves.

These files are the source of truth for the project's substance — its goal, accumulated context, decisions made, and current state. The chat in our app is ephemeral; this directory is durable.

## Files

- `goal.md` — what this project is for, in the user's own words
- `context.md` — what the manager needs to know to be useful on this project (architecture decisions, conventions, constraints, history)
- `decisions.md` — log of significant decisions made over the life of the project, with dates and the reasoning
- `board.md` — the project's current state at a glance (where it is now, what's next, what's blocked). Updated regularly by the manager.

## Conventions

- Edit these files directly if you want; the manager respects what's there.
- The manager owns these files as housekeeping in its own workspace, but won't make destructive changes without your awareness.
- These files are committed to git like any other content. Their history is the project's intellectual history.
~~~

### CEO_GOAL

This goes in `.ceo/goal.md`:

~~~markdown
# Goal

(Empty. The manager will ask about this on first session, or you can write it yourself.)

What is this project for? Why does it exist? When you describe what success looks like for this repo, what do you say?
~~~

### CEO_CONTEXT

This goes in `.ceo/context.md`:

~~~markdown
# Context

(Empty. Fill in as the project develops, or let the manager accumulate this through conversation.)

What does the manager need to know to be useful here? Architecture, conventions, technologies, history, constraints, who else is involved, anything that doesn't fit in goal.md or decisions.md.
~~~

### CEO_DECISIONS

This goes in `.ceo/decisions.md`:

~~~markdown
# Decisions

(Empty. Append entries as decisions are made.)

Format suggestion: each entry has a date, a short title, the decision itself, and why. Example:

## 2026-01-15 — Routing approach

Chose Remix-style file-system routing over a config-based router.

Why: matches the team's mental model from previous projects, and the config-based alternative was over-engineered for our scale.
~~~

### CEO_BOARD

This goes in `.ceo/board.md`:

~~~markdown
# Board

(Empty. The manager will update this regularly to reflect the project's current state.)

A glance view of where this project is right now:

**Goal:** (one sentence)
**State:** (one or two sentences)
**Next move:** (one strong phrase)
**Blockers:** (anything stuck or undecided)
~~~

---

## Notes for Dex

- The starter files are wrapped in `~~~markdown` fences in this file (instead of triple-backtick) so the inner markdown structure is preserved. When you copy the content into the TypeScript string constants in `src/lib/ceoScaffold.ts`, just use the content between the `~~~markdown` fences — don't include the fences themselves.
- The commit message when scaffolding should be something like: `Add .ceo/ directory — manager's working memory`.
- All five files get committed in the scaffolding pass. If putRepoFile is called sequentially, that's five separate commits, which is noisy but acceptable for v0. If you can batch them into one commit via the GitHub git data API (more complex), that's nicer but not required. **Default: five sequential putRepoFile calls. Acceptable.**
