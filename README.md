# The CEO

A repo-bound manager for each of your projects. You claim repos as projects from your GitHub account. The manager reads the `.ceo/` directory in each repo, dispatches Claude Code workers when execution is needed, and walks in caught up each session because its memory is committed to git.

---

## What it is

The project list is your GitHub account. Every repo is a potential project. When you claim one — either an existing repo or a freshly-created one — the system commits a `.ceo/` directory to it. That directory is the manager's persistent memory:

- `.ceo/goal.md` — what this project is for, in your words
- `.ceo/context.md` — what the manager needs to know to be useful
- `.ceo/decisions.md` — log of significant decisions over the life of the project
- `.ceo/board.md` — current state at a glance, updated by the manager
- `.ceo/README.md` — explains the directory to humans (and other tools) reading the repo

The manager reads these on every session. If the system disappeared, the project's memory would survive in the repo.

When real code needs to be written, the manager drafts a Claude Code prompt and dispatches a worker to **Claude Code running locally on your machine**. You click to authorize; the worker runs; output streams back into the conversation. You stay in the loop. The system holds the context.

Alongside the per-project managers: a **dropnote box** at the bottom of the screen for stray-thought capture. The **Brainstorm Room** and **Board** surfaces are coming in later runs.

## The principle

Tasks are dead. Managers are alive — they hold context, make judgment calls, remember why things exist. The bright line: **only you change state on your work.** The manager can think, brainstorm, research, draft, review, recommend — but it cannot push code, commit, or make destructive changes without your explicit click. The one exception: when you claim a repo, the system commits the initial `.ceo/` scaffold on your behalf — that commit IS initiated by your click on "Make this a project →".

## Architecture (one paragraph)

Cloudflare Workers + Durable Objects + D1 hold the operational shell. Per claimed project there's one `ManagerDO` (addressed by project UUID) holding the chat plumbing and a small DO-storage cache of the project's `.ceo/*.md` contents. A single `AgentHubDO` owns the websocket to the local agent. A React + Vite frontend bundles to static assets the Worker serves. A small Node process on your Mac/PC listens for execution requests and runs Claude Code against your repos. **The repo's `.ceo/` directory is the source of truth for the project's substance**; D1 is operational cache.

Full v2 spec in [`docs/design-v2.md`](docs/design-v2.md).

## Local development

First-time setup:

```bash
npm install              # installs root + web (npm workspaces)
cp web/.env.example web/.env   # set VITE_AUTH_TOKEN
```

Create `.dev.vars` in the repo root (plain UTF-8, no BOM):

```
ANTHROPIC_API_KEY=sk-ant-…
AUTH_TOKEN=…
GITHUB_TOKEN=…
AGENT_TOKEN=…
```

- `ANTHROPIC_API_KEY` — required. Every manager chat call uses it.
- `AUTH_TOKEN` — required. Bearer token gating `/api/*`. Must match `VITE_AUTH_TOKEN` in `web/.env`.
- `GITHUB_TOKEN` — **required in v3.** The project picker reads your GitHub repos directly; without this token the picker can't enumerate anything. Use a PAT with `repo` scope (classic) or a fine-grained token with **Contents: write** + **Administration: write** + **Metadata: read** on the repos you'll use as projects.
- `AGENT_TOKEN` — required only for the local agent. Bearer token the agent presents on `/api/agent/ws`.

Run both the Worker and the Vite dev server:

```bash
npm run dev
```

- Worker on `http://localhost:8787` (handles `/api/*` and `/health`)
- Vite dev server on `http://localhost:5173`

Open `http://localhost:5173`.

## The local agent

When the manager emits a `dispatch_claude_code` block and you click "Run Claude Code →", the job dispatches over a persistent websocket to a Node process on your machine. That process clones (if missing), runs Claude Code, captures the diff, and reports back.

```bash
cd agent
cp .env.example .env       # AGENT_TOKEN, WORKER_URL, REPOS_DIR, ANTHROPIC_API_KEY
npm install
npm start
```

Full agent docs in [`agent/README.md`](agent/README.md).

## Remote D1 migrations

Schema in [`src/db/schema.sql`](src/db/schema.sql). Migration files in [`src/db/migrations/`](src/db/migrations/).

### v3 rebuild (run #10)

**Wipes all v2 projects, chats, messages, briefings, and execution_jobs.** Drops the `briefings` table entirely (the manager reads `.ceo/*.md` instead). Reshapes `projects` to four columns: `(id, repo_full_name, clone_url, created_at)`. The `dropnotes` table and its contents are preserved.

```bash
# Local
npx wrangler d1 execute the-ceo-db --local --file=src/db/migrations/v3-repos-as-projects.sql

# Remote (this is the destructive one — production data goes)
npx wrangler d1 execute the-ceo-db --remote --file=src/db/migrations/v3-repos-as-projects.sql
```

If `--file` mode hits an authentication error against `/d1/database/{id}/import` (some OAuth-token scopes don't cover that endpoint), run the statements one at a time via `--command` instead. The migration file's statements are listed in order and each is independently idempotent on a freshly-wiped DB.

### v2 rebuild (run #9, historical)

Run #9's migration: `src/db/migrations/v2-rebuild.sql`. Applied previously to local + remote; included here for reference.

## Deployment

```bash
npm run build    # vite build → web/dist
npm run deploy   # wrangler deploy (Worker + bundled assets)
```

`not_found_handling = "single-page-application"` means deep links (e.g. `/projects/abc`) fall back to `index.html` so client-side routing resolves correctly.

Production secrets:
```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put AUTH_TOKEN
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put AGENT_TOKEN
```

## Documents

- [`docs/design-v2.md`](docs/design-v2.md) — **v2 spec of record** (current architecture; v3 evolution captured in the data-model section)
- [`docs/runs/run-10-prompt.md`](docs/runs/run-10-prompt.md) — Run #10 spec (this run)
- [`docs/runs/run-10-scaffold-content.md`](docs/runs/run-10-scaffold-content.md) — Verbatim SQL and `.ceo/` starter file contents
- [`docs/design.md`](docs/design.md) — Visual and experiential specification (carries forward)
- [`docs/vision.md`](docs/vision.md) — v1 vision (historical; principles carry, architecture changed)
- [`docs/employees.md`](docs/employees.md) — v1 staff roster (historical)
- [`docs/data-model.md`](docs/data-model.md) — v1 data model (historical)
- [`docs/v0-scope.md`](docs/v0-scope.md) — v0 scope (historical)
- [`docs/smoke-tests.md`](docs/smoke-tests.md) — v1 curl walkthrough (historical)
- [`agent/README.md`](agent/README.md) — Local Claude Code execution worker
