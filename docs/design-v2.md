# Design v2 — The Real System

This document supersedes the original architecture in `docs/vision.md`, `docs/architecture.md`, and `docs/employees.md`. Those docs describe v1 — the office-of-named-specialists model. Real use of v1 revealed that the underlying mental model was wrong. This doc describes the system we actually want.

The v1 docs are kept for historical reference but should not be treated as current spec.

---

## The mental model

**Two layers of work, plus a playground.**

- **Project Managers** — one per project, where deep work happens. The manager is bound to a repo. It is the manager.
- **The Board** — a glance surface showing the state of every active project. Updated by managers.
- **The Brainstorm Room** — a thinking space, separate from project work. Two AI voices (Brain 1 and Brain 2) conversing with you. Has a dropnote box for ambient capture.

That is the entire system. No CEO orchestrating staff. No specialists. No casting. No handoffs. Two surfaces for work, one surface for thinking.

---

## Principles

**1. A project is a repo.**

Every project equals exactly one GitHub repo. No repo, no project. Creating a project means creating (or attaching) a repo. The project list lives in your GitHub account; the system is a layer over GitHub.

**2. The manager lives in the repo.**

The manager's persistent memory is committed to the repo itself, in a `.ceo/` directory. The system's database is operational cache; the repo is the source of truth. If the system disappeared, the project's memory would survive in its repo.

**3. The bright line.**

The user is the only one who changes state on their work. The brains and managers can read, propose, draft, recommend. They cannot push code, create projects, or take irreversible actions without an explicit click.

The narrow exception: managers can edit their own `.ceo/` memory files as part of normal operation. This is housekeeping in their own workspace, not state changes to the user's work.

**4. Brains see everything.**

Brain 1 and Brain 2 have full read access to every repo, every chat in every project, every note, the Board. They cannot be useful if they can't pull patterns from the whole picture. They are extensions of the user's thinking.

**5. Workers are functional, not relational.**

When a manager needs heavy work done — code execution, deep research — it spawns a worker. Workers are temporary, task-bound, disposable. They have no identity, no memory of the user, no persistence beyond their task.

**6. AI behaves intelligently, not on cron.**

Where the system has triggers (manager posts to Board, brain references a note, etc.), the AI decides when based on context. Not timer-based, not scripted. The manager knows it posts to the Board regularly and at end of session — it figures out when.

---

## The three surfaces

### Surface 1: Project Manager Chat

**One per repo.**

The manager is the entity you talk to about a project. It:

- Reads the `.ceo/` memory files in its repo every session.
- Reads the repo's code, structure, README — has eyes on the code.
- Accepts file uploads in chat (screenshots, spreadsheets, PDFs, etc.).
- Can brainstorm, critique, draft, review — whatever the conversation needs.
- Drafts Claude Code prompts and dispatches workers.
- Reviews worker results and reports back to the user.
- Posts to the Board on its own judgment + at end of session + via manual user trigger.
- Can update the `.ceo/` memory files as it works (its own scratchpad / context).

The manager is *Dex-shaped* in its operational capability (close to the code, dispatches workers, drafts prompts) but does the full breadth of project work — exploring, critiquing, deciding — within its project's scope.

It is not a named character with a strong personality. It is *your project's Claude* — a thoughtful, repo-aware partner. (We may add light personality flavoring per project later, but the manager is functional first.)

**The `.ceo/` directory in each repo** holds:

```
.ceo/
  goal.md          — the project's goal in the user's words
  context.md       — accumulated context the manager needs to stay sharp
  decisions.md     — log of decisions made over the life of the project
  board.md         — the latest Board entry posted by this manager
  uploads/         — file uploads the user wants persisted
```

These files are committed to git and version-controlled. They are the manager's memory.

### Surface 2: The Board

**Glance view of every active project.**

The Board is a pop-out surface. You pull it open when you want to see where everything is at a glance. It closes back into the corner when you're done.

For each project, the Board shows:

- **The goal** — in a strong phrase
- **What's next** — in a strong phrase
- (Click for the full record — last activity, blockers, freeform notes)

The Board is updated by each project's manager. Managers post on three triggers:

1. **Behavior** — managers know they post regularly and at the end of working sessions. They use judgment about when.
2. **User trigger per project** — a manual "post current state" button in each project's manager chat.
3. **User trigger across the Board** — a "post all" button from the Board itself.

The Board's data structure (per project):

- Project name (= repo name)
- Last activity (timestamp)
- Current goal (one sentence)
- Current state (one or two sentences)
- Last action (most recent meaningful work)
- Next move (the next concrete step)
- Blockers / open questions
- Freeform note (manager's voice, anything the structured fields miss)

The Board is read by the user (primarily), the brains (when they need cross-project context), and managers (to know the state of related projects).

### Surface 3: The Brainstorm Room

**Thinking space. Not project work.**

The Brainstorm Room is a chat with two AI voices: **Brain 1** (logical, leads) and **Brain 2** (emotional, chimes in). They converse with you about anything you want to think about.

It is *not* where you ask about specific project issues. Those go to the project's manager. The Brainstorm Room is for wandering, generative, cross-cutting thought. A playground.

**Behavior of the two brains:**

- Brain 1 leads. When you send a message, Brain 1 responds first.
- Brain 2 chimes in when prompted (e.g., "what does Brain 2 think") or when the conversation naturally pulls for an emotional / intuitive perspective.
- The brains can talk to each other in front of you. Brain 1 might say something; Brain 2 might add to it or push back. You can direct the conversation to either.

**Both brains have full read access to:**

- All your repos (file trees, file contents, READMEs, commit history)
- All chats across all project managers
- All notes in the dropnote box
- The Board

The brains can deep-dive into any of these when needed. You tell them what you're looking for; they find the best way to pull it. They report back in the same conversation — they don't route you elsewhere.

**The brains can propose project creation.** When wandering through ideas, if something hardens into a real project, Brain 1 (or Brain 2) can propose creating a repo + initializing the `.ceo/` structure + assigning a manager. The user confirms. The brains then prep the new repo — scaffolding, initial context files, a starting Board entry — so the manager inherits a ready-to-work environment.

**The dropnote box.**

A quick-capture surface in the Brainstorm Room. You drop in thoughts, fragments, observations. The brains have full access — they read notes, archive notes, reference notes when relevant. The user doesn't manage notes; the brains do.

Notes persist until the brains archive them (or the user manually clears, if needed). The brains decide on their own judgment when to surface notes back into a conversation.

---

## What the brains can and cannot do

**Can do:**

- Read everything (all repos, all chats, all notes, the Board)
- Manage the dropnote box (read, archive, reference)
- Propose new projects (with the user's click to confirm)
- Prep newly-confirmed repos with scaffolding and `.ceo/` files
- Think — including out loud, in conversation, with each other

**Cannot do:**

- Push code to existing repos (only workers, dispatched by managers, can change repo state)
- Dispatch workers themselves
- Edit project briefings or Board entries directly
- Make destructive changes to anything

The brains are mind. The managers + workers are the hands.

---

## What managers can and cannot do

**Can do:**

- Read their own repo (full access — code, history, files)
- Read their own `.ceo/` files and write to them as part of normal operation
- Accept file uploads from the user
- Dispatch workers (Claude Code today; other worker types in the future)
- Post to the Board (on judgment + manual trigger)
- Draft, review, discuss, recommend

**Cannot do:**

- See or touch other projects' repos
- See or touch other projects' chats
- Make changes to the repo outside of `.ceo/` without a dispatched worker the user confirmed

Managers are bound to their repo. They are deep but not wide.

---

## What workers do

Workers are spawned by managers to do specific tasks. Today the only worker type is **Claude Code workers** — they execute code work on the user's machine via the local agent.

Future worker types may include:

- **Research workers** — fetch information from sources, summarize, report back
- **Review workers** — analyze a body of text/code and surface findings
- Others as needs emerge

Workers always require user confirmation before firing (the bright line — workers change state in the world).

Workers report back to their spawning manager. The manager digests the result and continues the conversation.

---

## The data model

### Source of truth: GitHub

Every project's identity and persistent memory lives in the repo:

- The repo itself is the project (name, structure, code)
- `.ceo/goal.md`, `.ceo/context.md`, etc. are the manager's committed memory
- Commit history of the `.ceo/` files is the audit trail

### Operational cache: The system's database

The system maintains an operational layer for things that aren't naturally git-shaped:

- Chat histories (per manager, per brainstorm session)
- Dropnote box contents
- The active Board snapshot (synced from repos)
- Worker job state (in-flight, queued, completed)
- User-level state (preferences, last session info)

If the operational database were lost, the system's *memory* of the projects would survive in the repos. Only operational and conversational state would be lost.

---

## What is being deprecated from v1

The following v1 concepts are retired:

- **The CEO as named character** — replaced by Brain 1 + Brain 2 in the Brainstorm Room
- **The four named employees** (Nora, Iris, Theo, Dex) — replaced by per-repo managers
- **`COMPANY_KNOWLEDGE`, `HANDOFF_TOOL`, `DEX_TOOLS`** — replaced by manager-specific prompting per repo
- **Casting** — replaced by automatic 1:1 repo-to-manager binding
- **Handoff between specialists** — no longer relevant; each project has one manager
- **The multi-pane workspace grid** — replaced by single-manager-per-project workspace + the Brainstorm Room as a separate surface
- **Briefings as D1 records** — replaced by `.ceo/` files committed to each repo

The infrastructure that survives:

- Cloudflare Workers + Durable Objects + D1 (operational layer)
- The local agent (executes workers)
- Claude Code worker dispatch (now called from manager, not Dex specifically)
- GitHub integration (expanded — read access, .ceo/ scaffolding on create)
- The web interface foundation (workspace, design language, streaming chat)

---

## Rebuild scope

The rebuild is meaningful but not a wipe. Most infrastructure survives. The reshape is:

1. **Strip v1 character vocabulary** — retire the four employees, casting, handoff, the CEO-as-character. Keep the Cloudflare backbone.
2. **Generalize the manager** — make every project a Dex-shaped manager with the full breadth of capabilities (brainstorming, critique, research, build, dispatch).
3. **Move briefings into repos** — establish `.ceo/` directory standard; managers read and write to their own.
4. **Build the Board as its own surface** — pop-out, glance-view, fed by managers.
5. **Build the Brainstorm Room** — two-brain conversation, dropnote box, full read access to everything.
6. **Build file upload into manager chats** — multi-modal input via Claude API attachments.
7. **Expand GitHub integration** — read access (file trees, file contents), repo creation with `.ceo/` scaffolding.

This will be done as a sequence of focused runs, not one monster rebuild. Each run ships something working.

---

## The principle behind the principles

The v1 system was an office. It had a CEO, staff, casting, handoffs — the metaphors of how human organizations work.

The v2 system is *you and your work, with thinking tools around you.* A board of repos. A manager per repo. A place to think.

The system is smaller. It does less in terms of structure. But what it does, it does well — and it gets out of the way of you actually working.

v1's mistake was confusing *modeling an organization* with *being useful to one person doing many kinds of work.* v2 corrects that.
