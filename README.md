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

## Documents

- [`docs/vision.md`](docs/vision.md) — Why this exists, the soul of the product
- [`docs/architecture.md`](docs/architecture.md) — Technical shape
- [`docs/employees.md`](docs/employees.md) — The staff roster and character sheets
- [`docs/data-model.md`](docs/data-model.md) — Core data structures
- [`docs/v0-scope.md`](docs/v0-scope.md) — What's in v0, what's explicitly out
