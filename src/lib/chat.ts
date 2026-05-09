// Shared chat-turn primitive. Every chat endpoint funnels through here.
//
// Flow per turn:
//   1. Load existing history (empty if chat is new).
//   2. Build the messages array in memory: history + the new user message.
//   3. Call Claude.
//   4. If Claude failed pre-flight, return an error SSE response. No DB changes —
//      the DB looks as if the turn never happened.
//   5. If Claude succeeded, persist the chat row (if new) AND the user message
//      in a single batch, then return a streaming Response. Background task
//      accumulates the assistant text and persists it after the stream ends.
//
// The user message is only written after Claude commits to a successful
// streaming response, so failed turns leave no orphan rows.
//
// Background assistant-message persistence is pinned via opts.waitUntil when
// callers (Durable Objects) supply one — that keeps the work alive past
// client disconnect mid-stream.

import { callClaude, parseTextEvents, ClaudeMessage } from "./claude";

export interface ChatTurnOpts {
  db: D1Database;
  chatId: string;
  systemPrompt: string;
  userMessage: string;
  apiKey: string;
  // Optional context applied only when auto-creating the chat row.
  projectId?: string;
  employeeId?: string;
  taskBrief?: string;
  // Optional waitUntil (from a DurableObjectState) — when provided, the
  // assistant-message persistence is pinned to the DO's lifecycle so it
  // survives mid-stream client disconnects. Without it, persistence is
  // best-effort fire-and-forget.
  waitUntil?: (promise: Promise<unknown>) => void;
}

const SSE_HEADERS: HeadersInit = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
};

export async function handleChatTurn(opts: ChatTurnOpts): Promise<Response> {
  const { db, chatId, systemPrompt, userMessage, apiKey } = opts;

  // 1. Load existing history. Tiebreak by id when created_at collides
  //    (default datetime('now') is per-second). Empty if chat is new.
  const { results: historyRows } = await db
    .prepare("SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC, id ASC")
    .bind(chatId)
    .all<{ role: string; content: string }>();

  const history: ClaudeMessage[] = historyRows
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // 2. Build messages in memory — DB stays untouched until Claude commits.
  const messages: ClaudeMessage[] = [...history, { role: "user", content: userMessage }];

  // 3. Call Claude.
  const result = await callClaude({ apiKey, system: systemPrompt, messages, stream: true });
  if (!result.ok) return errorSseResponse(result.message);
  if (!("stream" in result)) return errorSseResponse("Streaming requested but no stream returned.");

  // 4. Claude is good — persist the chat row (if new) and user message in one
  //    transaction. The chat insert must come first because messages.chat_id
  //    has a FK to chats(id) and D1 enforces FKs.
  await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO chats (id, project_id, employee_id, task_brief) VALUES (?, ?, ?, ?)")
      .bind(chatId, opts.projectId ?? null, opts.employeeId ?? null, opts.taskBrief ?? ""),
    db
      .prepare("INSERT INTO messages (id, chat_id, role, content) VALUES (?, ?, 'user', ?)")
      .bind(crypto.randomUUID(), chatId, userMessage),
  ]);

  // 5. Tee — forward one half to client, drain the other for persistence.
  const [forClient, forAccum] = result.stream.tee();

  const persistAssistant = (async () => {
    let full = "";
    try {
      for await (const delta of parseTextEvents(forAccum)) full += delta;
    } catch {
      // Best-effort accumulation; if upstream errors mid-stream, persist what we have.
    }
    if (full.length) {
      try {
        await db
          .prepare("INSERT INTO messages (id, chat_id, role, content) VALUES (?, ?, 'assistant', ?)")
          .bind(crypto.randomUUID(), chatId, full)
          .run();
      } catch {
        // Silent — best-effort.
      }
    }
  })();

  // Pin to DO lifecycle if available; otherwise fire-and-forget.
  if (opts.waitUntil) opts.waitUntil(persistAssistant);
  else void persistAssistant;

  return new Response(forClient, { headers: SSE_HEADERS });
}

/**
 * Pull a waitUntil function off a DurableObjectState if the runtime exposes
 * one. Different @cloudflare/workers-types versions disagree on whether this
 * is in the public type, so we feature-detect at runtime and stay narrow.
 */
export function getStateWaitUntil(
  state: DurableObjectState,
): ((p: Promise<unknown>) => void) | undefined {
  const wu = (state as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil;
  return typeof wu === "function" ? wu.bind(state) : undefined;
}

function errorSseResponse(message: string): Response {
  const body =
    `event: error\ndata: ${JSON.stringify({ message })}\n\n` +
    `event: done\ndata: {}\n\n`;
  return new Response(body, { headers: SSE_HEADERS });
}
