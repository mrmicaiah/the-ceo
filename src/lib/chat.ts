// Shared chat-turn primitive. Every chat endpoint funnels through here.
//
// Flow per turn:
//   1. Auto-create the chat row if chatId is unknown.
//   2. Persist the user message.
//   3. Load full history (ASC), drop system rows — system goes in the API
//      call's `system` field, not the messages array.
//   4. Stream from Claude. Tee the byte stream: one half to the client, one
//      half consumed in the background to accumulate text for persistence.
//   5. After the stream completes, persist the assistant message.
//
// v0 caveat: assistant-message persistence runs as a fire-and-forget background
// task. If the client disconnects mid-stream and the DO suspends before the
// task finishes, the assistant turn may not be saved. Acceptable for v0;
// revisit with state.waitUntil or an in-band persistence transform if it
// proves flaky in practice.

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
}

const SSE_HEADERS: HeadersInit = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
};

export async function handleChatTurn(opts: ChatTurnOpts): Promise<Response> {
  const { db, chatId, systemPrompt, userMessage, apiKey } = opts;

  // 1. Ensure chat row exists.
  const existing = await db.prepare("SELECT id FROM chats WHERE id = ?").bind(chatId).first();
  if (!existing) {
    await db
      .prepare("INSERT INTO chats (id, project_id, employee_id, task_brief) VALUES (?, ?, ?, ?)")
      .bind(chatId, opts.projectId ?? null, opts.employeeId ?? null, opts.taskBrief ?? "")
      .run();
  }

  // 2. Persist user message.
  await db
    .prepare("INSERT INTO messages (id, chat_id, role, content) VALUES (?, ?, 'user', ?)")
    .bind(crypto.randomUUID(), chatId, userMessage)
    .run();

  // 3. Load full history. Drop system rows; Claude takes the system prompt separately.
  //    Tiebreak by id when created_at collides (default datetime('now') is per-second).
  const { results } = await db
    .prepare("SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC, id ASC")
    .bind(chatId)
    .all<{ role: string; content: string }>();

  const messages: ClaudeMessage[] = results
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // 4. Stream from Claude.
  const result = await callClaude({ apiKey, system: systemPrompt, messages, stream: true });
  if (!result.ok) return errorSseResponse(result.message);
  if (!("stream" in result)) return errorSseResponse("Streaming requested but no stream returned.");

  // 5. Tee — forward one half to client, drain the other for persistence.
  const [forClient, forAccum] = result.stream.tee();

  void (async () => {
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
        // Silent — v0 best-effort.
      }
    }
  })();

  return new Response(forClient, { headers: SSE_HEADERS });
}

function errorSseResponse(message: string): Response {
  const body =
    `event: error\ndata: ${JSON.stringify({ message })}\n\n` +
    `event: done\ndata: {}\n\n`;
  return new Response(body, { headers: SSE_HEADERS });
}
