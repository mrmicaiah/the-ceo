# The CEO

A thinking layer that sits on top of Claude Code and the projects you actually work on.

---

## What it is

Each project is a repo. Each project has a **manager** — one AI thread bound to that repo, working with you across the full breadth of project work: brainstorming, critiquing, drafting, dispatching workers, reviewing what comes back. Not a roster of specialists; one role that shifts mode in conversation, the way a real colleague would.

When real code needs to be written, the manager drafts a Claude Code prompt and dispatches a worker to **Claude Code running locally on your machine**. You click to authorize; the worker runs; output streams back into the conversation. You stay in the loop. The system holds the context.

Alongside the per-project managers: a **dropnote box** at the bottom of the screen for stray-thought capture, and (coming in later runs) a **Brainstorm Room** with two brains for cross-project thought and a **Board** for persistent visual workspace.

## The principle

Tasks are dead. Managers are alive — they hold context, make judgment calls, remember why things exist. The bright line: **only you change state on your work.** Managers can think, brainstorm, research, draft, review, recommend — but they cannot push code, commit, or make destructive changes without your explicit click on a confirm-affordance.

## v1 / v2

The current codebase is v2. The original v1 design (CEO chief-of-staff + four named specialists Nora, Iris, Theo, Dex) has been retired. The v2 spec lives in [`docs/design-v2.md`](docs/design-v2.md). v1 docs ([`vision.md`](docs/vision.md), [`employees.md`](docs/employees.md), [`data-model.md`](docs/data-model.md), [`v0-scope.md`](docs/v0-scope.md)) are kept as historical reference; some principles carry forward, but the architecture has changed.

## Architecture (one paragraph)

Cloudflare Workers + Durable Objects + D1 hold the system. Per project there is one `ManagerDO` (addressed by project UUID) and one `ProjectDO` (holding the project's briefing). A single `AgentHubDO` owns the websocket to the local agent. A React + Vite frontend bundles to static assets the Worker serves. A small Node process on your Mac/PC listens for execution requests and runs Claude Code against your repos. Reports flow up; attention flows down.

Full details in [`docs/architecture.md`](docs/architecture.md). v2-specific design in [`docs/design-v2.md`](docs/design-v2.md).

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
- `AUTH_TOKEN` — required. Bearer token gating `/api/*`. Must match `VITE_AUTH_TOKEN` baked into the frontend at build time.
- `GITHUB_TOKEN` — required only for the `create_repo` action. GitHub PAT with `repo` scope.
- `AGENT_TOKEN` — required only for the local agent. Bearer token the agent presents on `/api/agent/ws`.

Run both the Worker and the Vite dev server:

```bash
npm run dev
```

- Worker on `http://localhost:8787` (handles `/api/*` and `/health`)
- Vite dev server on `http://localhost:5173` (serves the React app, proxies `/api/*` to the Worker)

Open `http://localhost:5173`.

`.dev.vars` must be UTF-8 with no BOM (`head -c 3 .dev.vars | xxd` — first byte `41` for `A`, not `ef bb bf` or `ff fe`).

Wrangler dev caches `.dev.vars` on first request. After editing, `touch src/index.ts` to force a code reload.

## The local agent

When the manager emits a `dispatch_claude_code` block and you click "Run Claude Code →", the job dispatches over a persistent websocket to a Node process on your machine. That process clones (if missing), runs Claude Code, captures the diff, and reports back.

```bash
cd agent
cp .env.example .env       # edit: AGENT_TOKEN, WORKER_URL, REPOS_DIR, ANTHROPIC_API_KEY
npm install
npm start
```

Full agent docs in [`agent/README.md`](agent/README.md). Without the agent running, dispatches queue indefinitely until the agent connects and flushes them.

## Remote D1 migrations

Schema in [`src/db/schema.sql`](src/db/schema.sql). Migration files in [`src/db/migrations/`](src/db/migrations/).

### v2 rebuild (run #9)

Wipes v1 conversation state, drops the per-employee notes table, renames `execution_jobs.dex_seen_at` → `manager_seen_at`, and creates the `dropnotes` table. Apply once after pulling this run:

```bash
# Local
npx wrangler d1 execute the-ceo-db --local --file=src/db/migrations/v2-rebuild.sql

# Remote
npx wrangler d1 execute the-ceo-db --remote --file=src/db/migrations/v2-rebuild.sql
```

The migration is non-idempotent on the `ALTER TABLE RENAME COLUMN` step. Apply once per environment.

### v1 history (kept for reference)

Earlier runs added `clone_url` to `projects` and `summary` / `dex_seen_at` to `execution_jobs`. The v2 migration above subsumes the seen-marker rename; `clone_url` and `summary` are untouched.

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

- [`docs/design-v2.md`](docs/design-v2.md) — **v2 spec of record** (current architecture)
- [`docs/architecture.md`](docs/architecture.md) — Technical shape
- [`docs/design.md`](docs/design.md) — Visual and experiential specification (carries forward to v2)
- [`docs/vision.md`](docs/vision.md) — v1 vision (historical; principles carry, architecture changed)
- [`docs/employees.md`](docs/employees.md) — v1 staff roster (historical)
- [`docs/data-model.md`](docs/data-model.md) — v1 data model (historical)
- [`docs/v0-scope.md`](docs/v0-scope.md) — v0 scope (historical)
- [`docs/smoke-tests.md`](docs/smoke-tests.md) — v1 curl walkthrough (historical)
- [`agent/README.md`](agent/README.md) — Local Claude Code execution worker
