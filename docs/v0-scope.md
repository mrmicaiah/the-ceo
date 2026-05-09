# v0 Scope

The principle: **build the smallest end-to-end loop that proves the feeling.** If the loop feels right, everything else is additive. If it feels wrong, no features will save it.

## What v0 must do

A single user can:

1. Open the web app and talk to **The CEO.**
2. Start a new project. The CEO knows about it.
3. Be assigned to one of the four employees (**Nora, Iris, Theo, or Dex**) for a specific task on that project.
4. Walk into that employee's chat with the right context already loaded.
5. Work with the employee. When done, the employee files a report.
6. The report updates the project's briefing. The CEO sees the update.
7. **Dex specifically** can draft a Claude Code prompt, fire it via the local agent, watch output stream back in the web app, and review the diff.
8. Reopen the app later. The CEO's greeting reflects everything that happened.

That's the loop. Everything in v0 supports that loop.

## What's in

- Cloudflare Worker + Durable Objects (CEO, Project, four Employees) + D1
- Auth (single user, simple)
- Web app: two-pane (CEO on left, current chat on right), project list, briefing view, Claude Code execution panel
- Chat primitive (used by all node types — CEO, employees)
- Briefing model + report flow + CEO digestion of reports
- All four employees with character sheets and basic memory
- Agent spawning — both flavors:
  - **Collaborative spawn** (the CEO casts an employee for you to talk to)
  - **Autonomous spawn** (the CEO dispatches an employee to go do something and report back)
- Local agent: Node process, websocket to Cloudflare, runs Claude Code, streams output
- One execution job per project at a time, queue if needed

## What's explicitly out

- Multi-user / teams
- Multi-machine execution (one Mac, one agent)
- Mobile-native polish (web on mobile is fine)
- Tree visualization (project list is enough)
- Search, tags, filters, archives
- Notification system beyond the CEO's greeting
- Anything fancy in the agent install flow — manual install for v0

## Build order

### Week 1 — Foundation

- Cloudflare backend skeleton: Worker, Durable Objects (CEO, Project, four Employees), D1 schema
- Chat primitive: one endpoint that takes (chat_id, message), loads system prompt + history, calls Claude API, streams response, persists
- Local agent: Node process, websocket connection, can run Claude Code via SDK and stream output back
- Crude UI: can talk to a CEO chat and a Dex chat, can fire a Claude Code run from Dex
- **End of week 1:** end-to-end flow works, even if ugly. No memory yet beyond chat history.

### Week 2 — The Brain

- Briefing model + storage
- Report flow: employees file structured reports, briefings update, CEO DO is pinged
- CEO processes incoming reports — updates project state, decides what's noteworthy, adjusts its long-term notes
- Employee memory: each employee writes a private note after meaningful interactions
- Agent spawning: the CEO can cast an employee for the user, or dispatch an employee autonomously
- **End of week 2:** the system feels like a system. The CEO's greetings reflect what's happened.

### Week 3 — Use it

No new features. Use The CEO on real projects for a week. Notice:
- What feels alive, what feels dead
- Which employees get used, which don't
- What the CEO gets right, what it gets wrong
- Where the handoffs feel seamless, where they feel like friction
- Where Claude Code execution feels native, where it feels bolted on

Keep notes. Don't fix anything yet.

### Week 4 — Sharpen

Fix the top three things from week 3. Ship.

## The three things v0 must nail

1. **The CEO's system prompt.** This is the soul. Iterate on it more than anything else. It needs to feel like a sharp chief of staff who actually holds your goals — not a status reporter.
2. **The employee → Claude Code handoff (Dex).** When Dex builds a prompt and fires it, that prompt has to be *good* — repo-aware, goal-aware, scoped right. Dex's value is concentrated here.
3. **The report → briefing → CEO chain.** Reports need to actually change the CEO's understanding, not just pile up. If a report comes in and the CEO's next greeting doesn't reflect it, the whole thing is theater.

## How we'll know v0 works

After week 3, sit with this question honestly: **does opening The CEO feel different from opening a chat list?**

If yes, ship and iterate. If no, the loop is wrong somewhere and we figure out where.
