# Smoke tests

End-to-end verification of the briefing → report → CEO digestion loop.

Run `npm run dev` first; `.dev.vars` must be plain UTF-8 with no BOM (see [`README.md`](../README.md)).
If the first request after starting wrangler hits a stale env (cached `.dev.vars`),
`touch src/index.ts` to force a code reload and retry.

All commands assume `localhost:8787`. Replace `<PROJECT_ID>` with the id returned by step 1.

---

## 1. Create a project

```bash
curl -s -X POST http://localhost:8787/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Routing-layer redesign",
    "initialGoal":"Build a clean routing layer for the new app shell that supports nested layouts and easy code-splitting"
  }'
```

Returns the project + initial briefing. Save the `id`.

## 2. Verify the briefing

```bash
curl -s http://localhost:8787/api/projects/<PROJECT_ID>
```

Should return the same shape: project + briefing fields (`goal`, `state`, `nextMove`, `why`).
The `/api/projects` surface uses camelCase (`repoPath`, `createdAt`, `nextMove`, `briefingUpdatedAt`); DB columns and the nested `/briefing` and `/report` endpoints remain snake_case.

## 3. Brainstorm with Nora (project context attached)

```bash
curl -s --no-buffer -X POST http://localhost:8787/api/employees/nora/chat \
  -H "Content-Type: application/json" \
  -d '{
    "chat_id":"smoke-3-nora",
    "project_id":"<PROJECT_ID>",
    "message":"I want to brainstorm directions for the routing layer. I keep flipping between file-system routing and a config-driven approach. Help me think."
  }'
```

Streams Nora's response as SSE. With `project_id` set, her system prompt now
includes the project briefing and her recent reports on it — she walks in cast.

Send a second turn (same `chat_id`) to converge:

```bash
curl -s --no-buffer -X POST http://localhost:8787/api/employees/nora/chat \
  -H "Content-Type: application/json" \
  -d '{
    "chat_id":"smoke-3-nora",
    "project_id":"<PROJECT_ID>",
    "message":"Lean me toward Remix-style file-system with explicit module exports, plus a small config layer for the truly weird routes. What would I lose?"
  }'
```

## 4. Wrap the chat — file the report

```bash
curl -s -X POST http://localhost:8787/api/chats/smoke-3-nora/wrap | jq
```

This single endpoint:

1. Loads the chat history
2. Asks Nora (in her voice) to file a report — JSON: `{asked_to_do, what_happened, artifact, open_questions, recommended_next_move}`
3. POSTs the report to the Project DO's `/report`, which:
   - Persists the report row
   - Asks Claude for an updated briefing (kept on Claude failure)
   - Asks Claude for a one-line ping + signal (`progress` | `blocked` | `stalled` | `done` | `needs_attention`)
   - POSTs the ping to CEO_DO `/ingest-ping` (fire-and-forget, pinned via `waitUntil`)
4. Marks the chat `wrapped`

Returns `{wrapped, report, briefing, ping}`.

## 5. Verify in D1

```bash
npx wrangler d1 execute the-ceo-db --local --command="SELECT id, from_employee, substr(what_happened,1,80) AS what_happened FROM reports WHERE project_id='<PROJECT_ID>'"

npx wrangler d1 execute the-ceo-db --local --command="SELECT goal, state, next_move, why, updated_at FROM briefings WHERE project_id='<PROJECT_ID>'"

npx wrangler d1 execute the-ceo-db --local --command="SELECT signal, summary, created_at FROM status_pings WHERE project_id='<PROJECT_ID>'"
```

Expect: 1 report row, 1 briefing row with updated `state`/`next_move`/`why` (and unchanged `goal`), 1 status_ping row.

## 6. Talk to the CEO — the moment of truth

```bash
curl -s --no-buffer -X POST http://localhost:8787/api/ceo/chat \
  -H "Content-Type: application/json" \
  -d '{"chat_id":"smoke-3-ceo","message":"Hey. Brief me — what is on my plate?"}'
```

The CEO's system prompt is now built from:

- All active projects + their briefings (joined from `projects`/`briefings`)
- The last 20 status_pings (joined with project names)
- The CEO's `pattern_notes` and `long_term_notes` from `ceo_state`

Expect a response that names the project, references the recent activity, and
takes a position on what should happen next. If you get generic chief-of-staff
filler, the context block didn't land — check `ceo.ts:buildContext` and the
wrangler dev cache (`touch src/index.ts` to reload).

## Failure-path notes

- **Claude API auth failure** during a chat → no DB writes (handled in `chat.ts`).
- **Claude returns invalid JSON** during the report flow → individual steps degrade gracefully:
  - Bad briefing JSON → briefing unchanged, report still persisted, ping still attempted.
  - Bad ping JSON → no ping persisted, no CEO ingestion, but report and updated briefing remain.
  - Bad pattern_notes JSON → `ceo_state.pattern_notes` unchanged.
- **Bad report JSON** during `/wrap` → 502 returned; chat stays open for retry.

## Cleanup (optional)

```bash
PROJECT_ID=...
npx wrangler d1 execute the-ceo-db --local --command="DELETE FROM messages WHERE chat_id IN ('smoke-3-nora','smoke-3-ceo')"
npx wrangler d1 execute the-ceo-db --local --command="DELETE FROM chats WHERE id IN ('smoke-3-nora','smoke-3-ceo')"
npx wrangler d1 execute the-ceo-db --local --command="DELETE FROM status_pings WHERE project_id='$PROJECT_ID'"
npx wrangler d1 execute the-ceo-db --local --command="DELETE FROM reports WHERE project_id='$PROJECT_ID'"
npx wrangler d1 execute the-ceo-db --local --command="DELETE FROM briefings WHERE project_id='$PROJECT_ID'"
npx wrangler d1 execute the-ceo-db --local --command="DELETE FROM projects WHERE id='$PROJECT_ID'"
```
