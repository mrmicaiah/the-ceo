# Run #10 — GitHub is the project list

You are the Builder for "The CEO" project. We're on run #10 — the v2 architecture lands properly.

Run #9 retired the v1 character vocabulary and rebuilt the workspace shell. But the project model is still v1's: D1's projects table is the source of truth, and the picker shows whatever's in it.

Run #10 corrects this: **GitHub is the project list.** Each repo is a candidate project. The user opts repos in by "claiming" them. Claiming scaffolds a `.ceo/` directory in the repo — that directory IS the project's persistent memory. The D1 row exists only as chat plumbing (where chats live, the repo's clone_url for the agent). Everything substantive lives in the repo.

This is bigger than #9 in surface area. Take it stage by stage. Each stage must leave the system at clean typecheck before moving to the next.

## Required reading

1. `docs/design-v2.md` — the architecture spec; pay particular attention to "A project is a repo" and the .ceo/ directory description
2. `docs/runs/run-10-scaffold-content.md` — the exact contents of the `.ceo/` starter files and the D1 migration SQL. Use these contents verbatim.
3. `README.md` — needs updating to reflect the new project flow
4. `src/db/schema.sql` — current schema (projects + briefings tables will be reshaped)
5. `src/lib/github.ts` — current GitHub helpers (createRepo exists; we add list-repos, get-file, put-file)
6. `src/index.ts` — adding `/api/repos` and `/api/projects/from-repo`; removing the briefing routes
7. `src/durable-objects/manager.ts` — system prompt context block currently reads briefings table; will read .ceo/ files from the repo instead
8. `src/durable-objects/project.ts` — currently handles `/briefing` reads; mostly retires
9. `web/src/components/ProjectTopBar.tsx` — the picker rewires significantly
10. `web/src/state/store.tsx` — state.projects becomes state.openProjects (just the open ones)
11. `web/src/lib/api.ts` — listProjects retires; listRepos + claimRepoAsProject + createNewProject arrive

## The new mental model

The project list is your GitHub account. Every repo is a *potential* project. You opt in by claiming. Claiming has two paths:

- "Make this a project" on an existing repo
- "+ New project" — create a brand new GitHub repo + claim it in one flow

Claiming a repo means:

- Server creates a D1 project row (id, repo_full_name, clone_url, created_at)
- Server commits a `.ceo/` directory to the repo via the GitHub API with five starter files (README, goal, context, decisions, board — see scaffold content file)
- The repo is now a project. Picker moves it to "Your projects".

The manager, on session start, reads the `.ceo/` files from the repo (via GitHub API) and includes them in its system prompt context. This replaces what used to be the briefing block. The manager's memory is the directory.

Writes from the manager to `.ceo/` files are deferred to a later run. For now, the manager READS `.ceo/` — writes happen via the user updating them manually (or, eventually, via a worker dispatch that the user confirms).

## Critical notes before you start

- The existing D1 projects (ReferVo, The CEO Build) get wiped. We're starting fresh. No data migration.
- The existing chats, messages, briefings, execution_jobs all get wiped too — they referenced projects we're nuking.
- The dropnotes table is NOT touched (project-independent).
- The dropnote table contents survive too.

---

## Stage 1: D1 wipe + schema simplification

Create `src/db/migrations/v3-repos-as-projects.sql` with the exact SQL from `docs/runs/run-10-scaffold-content.md` (section "Migration SQL").

Update `src/db/schema.sql` to reflect the v3 shape (drop briefings table definition, replace projects table definition with the simplified one from the migration).

Apply to local D1:

```
npx wrangler d1 execute the-ceo-db --local --file src/db/migrations/v3-repos-as-projects.sql
```

Note the equivalent `--remote` command in the final report so the user can apply it to production.

---

## Stage 2: GitHub helpers — list repos, read file, write file

In `src/lib/github.ts`, add three new operations alongside the existing `createRepo`:

**1. `listUserRepos(token)`** → returns array of repos for the authenticated user.

- GET `https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner`
- Headers: `Authorization: Bearer ${token}`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: the-ceo`
- Map each repo to: `{ name, fullName, description, cloneUrl, htmlUrl, defaultBranch, isPrivate, isArchived, isFork, updatedAt }`
- Filter out forks and archived repos by default (the user can override later if needed; for v0, just exclude them — they're noise)
- Handle the same auth/rate-limit cases as createRepo does today

**2. `getRepoFile(token, fullName, path, branch)`** → returns the file's content as a string, or null if not found.

- GET `https://api.github.com/repos/${fullName}/contents/${path}?ref=${branch}`
- Decode the base64 content
- 404 → return null
- Other errors → throw with context

**3. `putRepoFile(token, fullName, path, content, message, branch, sha?)`** → creates or updates a file via PUT to contents API.

- PUT `https://api.github.com/repos/${fullName}/contents/${path}`
- Body: `{ message, content: base64(content), branch, sha? }` (sha required for updates, omitted for creates)
- Returns the new sha
- Used by the scaffolding step to commit the initial `.ceo/` files

**4. New helper: `scaffoldCeoDirectory(token, fullName, defaultBranch)`** — calls `putRepoFile` five times to create the initial `.ceo/` files. Their contents come from constants exported from a new file `src/lib/ceoScaffold.ts` (Stage 3 below).

**5. Error handling.** A failed scaffold mid-flight (e.g., 3 files committed, 4th fails) should at minimum return a structured error so the caller can decide whether to retry or roll back. v0: log the partial state and surface a 500 with context — the user can re-claim the repo and the put-file operations will update-not-create since SHAs match. Acceptable.

---

## Stage 3: The .ceo/ directory standard

Create `src/lib/ceoScaffold.ts`. Export five string constants — the content of each starter file. **The exact content for each is in `docs/runs/run-10-scaffold-content.md` (section "Starter file contents").** Use those contents verbatim. The constants:

- `CEO_README`
- `CEO_GOAL`
- `CEO_CONTEXT`
- `CEO_DECISIONS`
- `CEO_BOARD`

---

## Stage 4: Backend endpoints

In `src/index.ts`, audit and update routes:

### Remove

- `/api/projects/:id/briefing` (GET) — no more briefings table
- `/api/projects/:id/briefing-update` (POST) — no more briefings
- The existing `/api/projects` (POST) for creating projects via name+goal — gets replaced by from-repo flow
- Anything in ProjectDO that handled `/briefing` — strip or retire the DO if it's now empty

### Add

**`GET /api/repos`** — calls `listUserRepos(env.GITHUB_TOKEN)`, then for each repo checks D1 for a matching `repo_full_name` row to set `isProject: boolean`. Returns the full list with `isProject` flag. If GITHUB_TOKEN missing, return 500 with clear error.

**`POST /api/projects/from-repo`** body `{ repoFullName, cloneUrl, defaultBranch }`:

- Look up existing project by `repo_full_name`. If found, return existing `{ projectId, repoFullName, cloneUrl, isNew: false }`.
- If not: create D1 row (UUID), call `scaffoldCeoDirectory(env.GITHUB_TOKEN, repoFullName, defaultBranch)` to commit the five `.ceo/` files. Return `{ projectId, repoFullName, cloneUrl, isNew: true }`. 201 on first create.
- If scaffolding fails: still create the D1 row (the project exists logically), but log + surface the scaffolding failure as a warning in the response (`{ ..., scaffoldingError: "..." }`). The manager will handle missing `.ceo/` gracefully (Stage 5).

**`POST /api/projects/new`** body `{ name, description?, private? }`:

- Calls `createRepo` (existing) to create a brand-new GitHub repo
- On success, calls the from-repo logic above (D1 row + scaffolding)
- Returns same shape as from-repo: `{ projectId, repoFullName, cloneUrl, isNew: true }`

### Keep (unchanged)

- `GET /api/projects/:id` — single project read. Update query to match new schema (no more goal/state/nextMove/why — just the basic project row).
- `GET /api/projects/:id/manager-chat` — manager chat resolution
- `POST /api/projects/:id/manager/chat` — manager chat turns
- `POST /api/projects/:id/dispatch-claude-code`
- All `/api/jobs/*` routes
- All `/api/dropnotes` routes
- `/api/agent/ws`
- `/health`

### TypeScript

Update `ProjectListItem` type in worker types and frontend types to reflect the new shape. New type `RepoListItem` for the GitHub list response.

---

## Stage 5: Manager reads .ceo/ files on session start

In `src/durable-objects/manager.ts`, the system prompt context block currently pulls from the briefings table. After this run, it pulls from the `.ceo/` directory in the project's repo.

### 1. Build the system prompt context block

When building the system prompt for a chat turn:

- Look up the project row by ID to get `repo_full_name` and `clone_url`
- Call GitHub `getRepoFile` four times in parallel: `goal.md`, `context.md`, `decisions.md`, `board.md`
- Fold them into the system prompt as a block with this exact shape:

```
## Current project: <repo_full_name>

Current project ID: <project_uuid>
Repo: <clone_url>

### Goal
<contents of .ceo/goal.md, or "(not yet set)" if empty>

### Context
<contents of .ceo/context.md, or "(not yet captured)" if empty>

### Recent decisions
<contents of .ceo/decisions.md, or "(none recorded)" if empty>

### Board
<contents of .ceo/board.md, or "(not yet posted)" if empty>
```

### 2. Handle missing files gracefully

- If a file returns null (404 from GitHub), substitute with `(file not found in .ceo/ — directory may be missing or this file hasn't been created yet)`
- If the entire `.ceo/` directory is missing (multiple 404s), include a top-level note: `Warning: .ceo/ directory may be missing from this repo. The manager is operating without committed memory until this is restored.`
- Don't fail the chat turn over missing files. The manager works without memory if it has to.

### 3. Cache

GitHub reads are slow (network round-trip). The DO has storage. Use it.

- Cache the four `.ceo/` file contents per project in DO storage with a short TTL (60 seconds is fine for v0)
- On each turn, check cache first; if stale/missing, fetch fresh
- When run #11 adds writes, the cache invalidates on every write — but that's a future concern
- This avoids 4 GitHub API calls on every chat turn

### 4. Token cost note

The `.ceo/` block can grow large over time. v0 acceptable. Future hardening might summarize/compress long context files. Out of scope for run #10.

---

## Stage 6: Frontend rewire

### 1. Picker (`web/src/components/ProjectTopBar.tsx` → `ProjectPicker`)

The picker is now a two-section dropdown. Layout:

```
YOUR PROJECTS
─────────────
the-ceo Build
refervo-app

OTHER REPOS
─────────────
some-other-repo                 Make this a project →
another-experiment              Make this a project →
...

─────────────
+ New project
```

- Top section: repos with `isProject: true`. Click → opens workspace (existing flow).
- Bottom section: repos with `isProject: false`. Each row shows the repo name + description (if any). A "Make this a project →" affordance on the row (or row click — your judgment). Clicking calls `POST /api/projects/from-repo` then opens workspace.
- Footer: a "+ New project" button. Click → opens `NewProjectModal` (resurrect from the deleted v1 component, but simpler — just name + description, no goal field). Submit → `POST /api/projects/new` then opens workspace.
- Loading state visible while GitHub list is fetching (it's an external API call; can take a second).
- Empty state if no repos at all: `No repos found on your GitHub account. Create one to get started.`

### 2. api.ts updates

- Remove `listProjects` (gone)
- Add `listRepos()` → fetches `/api/repos`
- Add `claimRepoAsProject({ repoFullName, cloneUrl, defaultBranch })` → POST `/api/projects/from-repo`
- Add `createNewProject({ name, description?, isPrivate? })` → POST `/api/projects/new`
- Remove `getBriefing`, `updateBriefingField` (gone)

### 3. State (`web/src/state/store.tsx`)

- Remove `state.projects` and `refreshProjects` (no longer makes sense — repos come from GitHub, not D1)
- The store now only tracks `workspaces[]` (open projects) and `activeWorkspaceId`
- The picker fetches its data fresh from `/api/repos` on each open (small caching is fine but not required)
- Workspace state shape unchanged from run #9
- When a repo is claimed and opened, the workspace gets created with the returned `projectId`

### 4. Types (`web/src/types.ts`)

- Update `ProjectListItem` to the minimal shape: `{ id, repoFullName, cloneUrl, createdAt }`
- Add `RepoListItem`: `{ name, fullName, description, cloneUrl, htmlUrl, defaultBranch, isPrivate, updatedAt, isProject }`

### 5. NewProjectModal

- Recreate. Simple form: name (required), description (optional), private (default true).
- Submit → `createNewProject` → on success, open the new workspace.
- Match the editorial design language from run #9's design notes.

---

## Stage 7: docs + README updates

### 1. Update `docs/design-v2.md`

Find the "The data model" section. Replace its contents to reflect what landed:

- Source of truth: GitHub repos
- `.ceo/` directory in each repo = persistent project memory (4 files: goal, context, decisions, board, plus README)
- D1 projects table = minimal chat plumbing (id, repo_full_name, clone_url, created_at). One row per claimed repo.
- D1 chats/messages = conversational state; ephemeral but stored
- D1 dropnotes = ambient capture across the system
- Operational vs durable: if the operational DB is lost, the project's memory survives in the repo. Only chat histories and dropnotes are lost.

### 2. Update `README.md`

- Adjust the architecture-one-paragraph section to reflect repo-as-project
- Update the "what it is" intro: `A repo-bound manager for each of your projects. You claim repos as projects from your GitHub account. The manager reads the .ceo/ directory in each repo, dispatches Claude Code workers when execution is needed, and walks in caught up each session because its memory is committed to git.`
- Add to the migrations section: the `v3-repos-as-projects.sql` migration
- Note that the system requires `GITHUB_TOKEN` to even show the project picker now (it's not optional anymore)

---

## Constraints

- Each stage typechecks clean before the next stage begins. Don't pile broken changes.
- The visual language is unchanged from run #9 — Fraunces, ink-blue, paper, hairlines, editorial restraint.
- All Claude calls continue to use `claude-opus-4-5`.
- DON'T COMMIT. Working tree changes for me to review.
- The agent doesn't need changes this run; the dispatch payload is unchanged.

---

## Smoke test

After all seven stages, verify end-to-end:

1. Open the deployed app. Hard refresh. Confirm the workspace shows empty state ("The CEO — open a project from the dock above...").

2. Click `+` in the top bar. Picker opens. It should be loading briefly, then show:
   - "Your projects" section (initially empty after the wipe)
   - "Other repos" section listing all non-fork non-archived GitHub repos
   - "+ New project" at the bottom

3. Click "Make this a project →" on the `the-ceo` repo. Should:
   - Briefly show a loading state
   - Commit `.ceo/` files to the the-ceo repo (verify via GitHub UI if you want)
   - Open the project as a workspace
   - Move the-ceo from "Other repos" to "Your projects" if you re-open the picker

4. Talk to the manager. Confirm:
   - It greets in voice (direct, practical, low-ego)
   - Its context shows the project name and current goal status ("(not yet set)")
   - Asking "what's my goal?" should make it ask the user what the goal is

5. Open the picker again. Confirm `the-ceo` is now in "Your projects", and "Other repos" no longer lists it.

6. Click "+ New project". Modal opens. Fill in name + description. Submit. Should:
   - Create a new GitHub repo
   - Scaffold `.ceo/` in it
   - Open it as a workspace
   - Appear in "Your projects" on next picker open

7. Drop a note in the dropnote box. Confirm still works.

8. Open 2-3 projects simultaneously. Confirm grid layout still works as in run #9.

---

## What's explicitly NOT done (deferred)

- Manager writes to `.ceo/` files (run #11)
- Brainstorm Room (later run)
- The Board surface (later run — `board.md` content is already in the system as a placeholder)
- File upload in manager chats (later run)
- Brains can claim repos as projects (later run, with Brainstorm Room)
- Repo filtering/search in the picker (out of scope; if you have 50 repos, scroll)
- Showing forks/archives in the picker (filtered out; can add toggle later)

---

## Final report

When done, provide:

1. Files created / modified / deleted (full list)
2. Typecheck status (worker + frontend; agent unchanged)
3. Smoke test results — pass/fail/note for each of 1-8 above. For steps requiring browser interaction, trace through the code paths and verify the API surface live with curl.
4. Decisions and flags — anything that surprised you, anywhere you deviated from spec, anything that needs follow-up
5. UI description in long-form prose (same style as previous runs) — what the new picker, the claim flow, and the manager-with-.ceo-context feel like
6. Confirmation that scaffolding works against a real GitHub repo (show the commit on the user's repo if possible — the `.ceo/` directory should appear in the working tree of `the-ceo` after step 3 of the smoke test)
7. The remote D1 migration command for the user to apply to production

---

## One thing to be careful about

The scaffolding step writes to the user's actual GitHub repos. This is the first place we cross from "the worker writes only to its own D1" to "the worker writes to the user's data on GitHub". The scaffolding is small (5 files in a new directory), but it IS a real commit on the user's repo.

Be careful:

- Use a clear commit message: "Add .ceo/ directory — manager's working memory" or similar
- Only scaffold once per repo (the from-repo endpoint is idempotent; second call should not re-scaffold)
- If a `.ceo/` directory ALREADY exists in the repo (manually added, or somehow), treat the repo as already a project — don't overwrite anything. Surface a flag in the response (`{ ..., alreadyHadCeoDirectory: true }`) so the user knows.

The bright line is preserved because this commit is initiated by an explicit user click on "Make this a project →". The user is the one who triggers it.

Proceed with all seven stages. If anything is unclear, ask before building the wrong shape.
