# The CEO

**Chief Executive Orchestrator**

A thinking layer that sits on top of Claude Code and runs your projects like a small staffed office.

---

## What it is

The CEO is a single AI chief of staff that holds the strategic picture across all your projects. Beneath The CEO is a small fixed staff of four AI employees, each with a defined role and personality. The CEO assigns them to your projects as needed, and they always work *with* you — never autonomously.

When real code needs to be written, an employee drafts a prompt and dispatches it to **Claude Code** running locally on your machine. You stay in the loop. The system holds the context.

## The principle

Tasks are dead. They're snapshots. Managers are alive — they hold context, make judgment calls, and remember why things exist. The CEO is built on managers, not tasks.

## The staff

- **Nora** — Brainstormer. Loose, generative, sharp enough to push back.
- **Iris** — Critic. Dry, precise, doesn't flatter. Reads your work and tells the truth.
- **Theo** — Researcher. Methodical. Goes off on his own and comes back with the goods.
- **Dex** — Builder. Lives in the repo. Drafts Claude Code prompts and runs them.

Above all four sits **The CEO** — always on, sees everything, holds the goals.

## Architecture (one paragraph)

Cloudflare Workers + Durable Objects + D1 hold the brain (CEO, employees, project briefings, report log, chat history). A web app is the primary interface. A small local agent on your Mac listens for execution requests from the cloud and runs Claude Code against your repos. Reports flow upward; attention flows downward.

Full details in [`docs/architecture.md`](docs/architecture.md).

## Status

v0 in progress. See [`docs/v0-scope.md`](docs/v0-scope.md) for what's being built first.

## Local development

First-time setup:

```bash
npm install              # installs root + web (npm workspaces)
cp web/.env.example web/.env   # set VITE_AUTH_TOKEN — same string is fine for v0
```

Then create `.dev.vars` in the repo root (plain UTF-8, no BOM — see below) with all four secrets the Worker reads:

```
ANTHROPIC_API_KEY=sk-ant-…
AUTH_TOKEN=…
GITHUB_TOKEN=…
AGENT_TOKEN=…
```

- `ANTHROPIC_API_KEY` — required. Anthropic API key for every CEO/employee chat.
- `AUTH_TOKEN` — required. Bearer token the Worker compares against `Authorization: Bearer …` on every `/api/*` call. Must match the value baked into the frontend via `VITE_AUTH_TOKEN` in `web/.env`. Without it the Worker returns `500 {"error":"auth not configured on server"}` on every API request.
- `GITHUB_TOKEN` — required only for the `create_repo` action. A GitHub Personal Access Token with `repo` scope (classic or fine-grained). Without it, `POST /api/github/create-repo` returns `500 {"error":"GITHUB_TOKEN not configured on server"}`; the rest of the app still works.
- `AGENT_TOKEN` — required only for the local agent. Bearer token the agent presents on `/api/agent/ws`. Distinct from `AUTH_TOKEN`. Without it on the Worker, `/api/agent/ws` returns `500 {"error":"AGENT_TOKEN not configured on server"}`; without it on the agent side, the agent can't connect. See [`agent/README.md`](agent/README.md).

Run both the Worker and the Vite dev server with one command:

```bash
npm run dev
```

That starts:
- the Cloudflare Worker on `http://localhost:8787` (handles `/api/*`)
- the Vite dev server on `http://localhost:5173` (serves the React app, proxies `/api/*` to the Worker)

Open `http://localhost:5173` in your browser.

Note: `.dev.vars` must be plain UTF-8 with no BOM. PowerShell's default encodings often add a BOM or write UTF-16 — verify with `file .dev.vars` (expect `ASCII text`) or `head -c 3 .dev.vars | xxd` (expect the first byte to be `41` for `A`, not `ef bb bf` or `ff fe`).

Wrangler dev caches `.dev.vars` values and may serve stale env on the first request after a swap. Workaround: `touch src/index.ts` (or any source file) to force a code reload after editing `.dev.vars`.

## The local agent

When Dex emits a `dispatch_claude_code` block and the user clicks "Run Claude Code →", the job is dispatched over a persistent websocket to a small Node process running on the user's Mac/PC. That process clones (if missing), runs Claude Code, captures the diff, and reports back.

To run it locally:

```bash
cd agent
cp .env.example .env
# edit agent/.env — AGENT_TOKEN, WORKER_URL, REPOS_DIR, ANTHROPIC_API_KEY
npm install
npm start
```

Full agent docs in [`agent/README.md`](agent/README.md). The agent needs to be running for any `dispatch_claude_code` action to actually execute; if it's offline, the Worker queues the job and flushes it on the next agent `ready`.

### Remote D1 migrations

The agent flow added two columns to existing tables. If your remote D1 was created before this run, apply once:

```bash
npx wrangler d1 execute the-ceo-db --remote --command "ALTER TABLE projects ADD COLUMN clone_url TEXT"
npx wrangler d1 execute the-ceo-db --remote --command "ALTER TABLE execution_jobs ADD COLUMN summary TEXT NOT NULL DEFAULT ''"
npx wrangler d1 execute the-ceo-db --remote --command "ALTER TABLE execution_jobs ADD COLUMN dex_seen_at TEXT"
npx wrangler d1 execute the-ceo-db --remote --command "CREATE INDEX IF NOT EXISTS idx_jobs_dex_unseen ON execution_jobs(project_id, status, dex_seen_at)"
```

These are idempotent only across fresh DBs; on existing tables, the `ADD COLUMN` will error if the column already exists. That's expected — just skip the ones that error and continue.

## Deployment

Single deploy target: the existing Cloudflare Worker. The built frontend ships as static assets bound to the Worker via `[assets]` in `wrangler.toml`, so the same Worker serves both `/api/*` and the SPA shell at every other path.

```bash
npm run build    # vite build → web/dist
npm run deploy   # wrangler deploy (pushes the Worker + bundled assets)
```

`not_found_handling = "single-page-application"` means deep links (e.g. `/projects/abc/chat/xyz`) fall back to `index.html` so client-side routing resolves correctly.

Production env vars (the Worker only):
```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

The frontend bundle reads `VITE_AUTH_TOKEN` at build time from `web/.env`. v0 doesn't validate it server-side; we'll harden in a later run.

## Documents

- [`docs/vision.md`](docs/vision.md) — Why this exists, the soul of the product
- [`docs/architecture.md`](docs/architecture.md) — Technical shape
- [`docs/design.md`](docs/design.md) — Visual and experiential specification
- [`docs/employees.md`](docs/employees.md) — The staff roster and character sheets
- [`docs/data-model.md`](docs/data-model.md) — Core data structures
- [`docs/v0-scope.md`](docs/v0-scope.md) — What's in v0, what's explicitly out
- [`docs/smoke-tests.md`](docs/smoke-tests.md) — End-to-end curl walkthrough
- [`agent/README.md`](agent/README.md) — Local Claude Code execution worker
