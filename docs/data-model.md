# Data Model

Core entities. Shapes only — storage decisions live in [`architecture.md`](architecture.md).

---

## Project

A top-level container. The CEO oversees ten or so at a time.

```
Project {
  id
  name
  created_at
  status: active | dormant | archived
  briefing: Briefing  // current snapshot
  repo_path?         // local path Dex/Claude Code use
}
```

## Briefing

The living document the CEO reads. One per project. Updated whenever a meaningful report comes in.

Four fields. That's the whole point.

```
Briefing {
  goal         // what this project is, really
  state        // where it is right now (phase, current focus)
  next_move    // the next concrete thing to do
  why          // why that next move serves the goal
  updated_at
}
```

If the briefing has more than four fields, we've drifted from the design.

## Report

Filed upward by an employee when a chat or task wraps. Append-only log per project.

```
Report {
  id
  project_id
  from_employee   // Nora | Iris | Theo | Dex
  parent_node_id? // chat or manager that received the report
  asked_to_do     // what the employee was assigned
  what_happened   // what actually got done
  artifact?       // the deliverable: a draft, a prompt, a diff, a decision
  open_questions?
  recommended_next_move
  created_at
}
```

Reports also generate a **status ping** — a one-liner that bubbles up to the CEO. The full report stays at the project level; the CEO sees the ping.

## Status ping

What the CEO actually consumes for cross-project awareness.

```
StatusPing {
  project_id
  summary       // one or two sentences
  signal: progress | blocked | stalled | done | needs_attention
  created_at
}
```

## Employee

Fixed roster. Four entries: Nora, Iris, Theo, Dex.

```
Employee {
  id            // 'nora' | 'iris' | 'theo' | 'dex'
  name
  role
  character_sheet  // permanent system prompt foundation
  user_notes       // accumulated learnings about the user (private)
}
```

The character sheet doesn't change. The user notes grow over time.

## Chat

A conversation with The CEO or with an employee on a project.

```
Chat {
  id
  project_id?       // null for CEO chats
  employee_id?      // null for CEO chats
  parent_chat_id?   // who spawned this chat
  status: active | wrapped
  task_brief        // what this chat was assigned to do
  report_shape      // schema for the report it owes back
  messages: [Message]
  created_at
}
```

## Message

```
Message {
  id
  chat_id
  role: user | assistant | system
  content
  created_at
}
```

## Execution job

A Claude Code run dispatched to the local agent.

```
ExecutionJob {
  id
  project_id
  chat_id            // who fired it (usually a Dex chat)
  prompt             // the Claude Code prompt
  status: queued | running | completed | failed
  output_stream?     // streamed back from the agent
  diff_summary?      // on completion
  created_at
  completed_at?
}
```

One running job per project at a time. Others queue.

## CEO state

The CEO's own persistent state — distinct from any project.

```
CEOState {
  long_term_notes    // running observations about the user
  pattern_notes      // cross-project patterns the CEO has noticed
  last_briefing_to_user  // what the CEO said last time the user opened the app
  last_user_seen_at
}
```

---

## What's not in the data model

No tags. No labels. No priority field. No due dates. No tree visualization data.

If any of those start feeling necessary, that's a signal that the briefing or the CEO's judgment isn't doing its job. Add carefully.
