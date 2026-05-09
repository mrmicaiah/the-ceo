# Architecture

## High-level shape

The CEO has three layers:

1. **The Brain** — Cloudflare Workers + Durable Objects + D1. Always on. Holds The CEO, the employees, the project briefings, the report log, and chat history.
2. **The Interface** — A web app (works on desktop and mobile). The primary surface for talking to The CEO and the employees.
3. **The Hands** — A small local agent on your Mac. Listens to the cloud over a persistent connection. When the cloud says "run this prompt," the agent invokes Claude Code in the right repo and streams the output back.

Reports flow upward. Attention flows downward. Code execution flows out to your machine and back.

## Why this shape

**Why cloud for the brain:** The CEO needs to be always-on. Reports pour in for days while you're not looking. The CEO digests them as they arrive — updating project briefings, noticing patterns, deciding what should bubble up. If the brain lived on your laptop, it would sleep when you sleep. That kills the whole premise.

**Why a local agent:** Claude Code needs a real filesystem with a real repo. It edits files, runs tests, commits. Browsers can't do that. So *somewhere* there has to be a process on a machine that has your code. The local agent is that process — small, dumb, and focused. The brain decides what to run; the agent runs it.

**Why web for the UI:** Accessible from anywhere. You can be at a coffee shop, talk to The CEO, queue a Claude Code run. Your Mac at home executes when it next sees the queue. By the time you're back, the diff is waiting.

## The pieces

### Cloudflare Worker (router)

Serves the web app and the API. Handles auth. Routes requests to the right Durable Object.

### Durable Objects

One **CEO DO** (singleton): always-on, holds cross-project state, processes incoming reports, maintains long-term notes about the user.

One **Project DO per project**: holds that project's tree, its briefing, its chats, its report log. Wakes when a chat is active or a report comes in.

Four **Employee DOs** (Nora, Iris, Theo, Dex): each one holds that employee's character sheet and their accumulated memory of working with the user. The CEO consults them when assigning work.

### D1 (SQL)

Durable storage for things that need to survive and be queried: project list, briefings (current snapshot per project), report log (append-only), chat history, employee notes.

### Web app

Two-pane primary view:
- **Left:** The CEO chat — always available, always-on conversation.
- **Right:** Whichever employee/chat you're currently in.

Buttons to spawn a new project, send a Claude Code run, view a project's briefing.

### Local agent

Node process running on the user's Mac. Persistent websocket connection to the Cloudflare backend. Listens for execution jobs. When one arrives:

1. Verify the job is for a known project / repo.
2. Invoke Claude Code (via SDK or CLI) with the prompt.
3. Stream output back to the cloud in real time.
4. On completion, send the diff summary and final result up.

Auto-starts at login. Reconnects on its own. Auth via a token tied to the user's account.

## The core loop

1. User opens the web app. The CEO greets them with a current briefing.
2. User picks a project. The CEO routes them into a chat with the right employee — say, Dex on Project 2.
3. Dex (a chat with Dex's system prompt + Project 2's briefing + the specific task) works with the user. They draft a Claude Code prompt together.
4. User approves. The cloud queues an execution job. The local agent picks it up. Claude Code runs locally. Output streams back to the web app in real time.
5. When Claude Code finishes, Dex reviews the result with the user. They write a report.
6. The report flows up. The Project DO updates its briefing. The CEO DO is pinged, processes the report, updates its cross-project view.
7. Next time the user opens the app, the CEO's greeting reflects what just happened.

## Async and pipelining

Multiple things can happen at once:

- **Claude Code execution is async.** The user can be brainstorming with Nora about the next prompt while Claude Code is still running the previous one. When it finishes, Dex gets notified and can fold the result into whatever conversation is happening.
- **Background workers can run while the user isn't looking.** Theo (Researcher) gets dispatched, goes off, files a report when done. The CEO digests it. The user sees the result next time they open the app.
- **Only one Claude Code execution per project at a time.** Enforced in the backend. Queued if needed.

## What's deliberately not in v0

- Multi-user / teams. Single user only.
- Multi-machine execution. One Mac, one local agent.
- Mobile-native polish. Web app on mobile is fine.
- Tree visualization. A simple project list and chat panes are enough.

See [`v0-scope.md`](v0-scope.md) for the build plan.
