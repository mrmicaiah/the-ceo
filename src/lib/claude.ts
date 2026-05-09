// Wrapper around Anthropic's Messages API.
// Streams by default; re-emits a thin SSE event stream the client can consume:
//   event: text   data: {"delta": "..."}    // one per content delta
//   event: done   data: {}                  // final, always last
//   event: error  data: {"message": "..."}  // on upstream failure mid-stream
//
// Errors before the stream starts are returned as a structured value, not thrown.

const MODEL = "claude-opus-4-5";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClaudeCallOpts {
  apiKey: string;
  system: string;
  messages: ClaudeMessage[];
  max_tokens?: number;
  stream?: boolean;
}

export type ClaudeResult =
  | { ok: true; text: string }                       // when stream === false
  | { ok: true; stream: ReadableStream<Uint8Array> } // when stream !== false
  | { ok: false; status: number; message: string };

/**
 * Call Claude. Default streaming. On error, returns { ok: false, status, message };
 * never throws raw network errors. Caller decides how to surface failures.
 */
export async function callClaude(opts: ClaudeCallOpts): Promise<ClaudeResult> {
  const stream = opts.stream ?? true;

  let upstream: Response;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: opts.max_tokens ?? 4096,
        system: opts.system,
        messages: opts.messages,
        stream,
      }),
    });
  } catch (err) {
    return { ok: false, status: 0, message: `Network error reaching Anthropic: ${(err as Error).message}` };
  }

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => "");
    return { ok: false, status: upstream.status, message: explainError(upstream.status, body) };
  }

  if (!stream) {
    const json = (await upstream.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = json.content?.find((b) => b.type === "text")?.text ?? "";
    return { ok: true, text };
  }

  if (!upstream.body) {
    return { ok: false, status: 502, message: "Upstream returned no body for streaming request." };
  }

  return { ok: true, stream: transformAnthropicSSE(upstream.body) };
}

/**
 * Async iterator over text deltas in our cleaned SSE stream.
 * Use with ReadableStream.tee() when you need to forward bytes to a client
 * AND accumulate the full assistant text for persistence.
 */
export async function* parseTextEvents(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const ev = parseSseEvent(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
        if (ev?.type === "text" && typeof ev.data?.delta === "string") {
          yield ev.data.delta;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Internals ──────────────────────────────────────────────────────────

function explainError(status: number, body: string): string {
  if (status === 401) return "Anthropic auth failed — check ANTHROPIC_API_KEY.";
  if (status === 429) return "Anthropic rate limit hit. Try again in a moment.";
  if (status >= 500) return `Anthropic upstream error (${status}). Try again.`;
  return `Anthropic error ${status}: ${body.slice(0, 200)}`;
}

/**
 * Anthropic emits events including:
 *   content_block_delta -> { delta: { type: 'text_delta', text: '...' } }
 *   message_stop        -> end of message
 *   error               -> mid-stream failure
 * We re-emit only `text`, `done`, and `error` to keep the wire format simple.
 */
function transformAnthropicSSE(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      let buffer = "";
      let stoppedCleanly = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const ev = parseSseEvent(raw);
            if (!ev) continue;
            if (ev.type === "content_block_delta") {
              const text = ev.data?.delta?.text;
              if (typeof text === "string" && text.length) {
                controller.enqueue(encoder.encode(formatSse("text", { delta: text })));
              }
            } else if (ev.type === "message_stop") {
              stoppedCleanly = true;
              controller.enqueue(encoder.encode(formatSse("done", {})));
            } else if (ev.type === "error") {
              controller.enqueue(encoder.encode(formatSse("error", ev.data ?? { message: "Unknown upstream error" })));
            }
          }
        }
        if (!stoppedCleanly) {
          // Upstream closed without message_stop — still tell the client we're done.
          controller.enqueue(encoder.encode(formatSse("done", {})));
        }
      } catch (err) {
        controller.enqueue(encoder.encode(formatSse("error", { message: (err as Error).message })));
      } finally {
        controller.close();
      }
    },
  });
}

interface ParsedSseEvent { type: string; data: any }

function parseSseEvent(raw: string): ParsedSseEvent | null {
  let type = "";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!type) return null;
  const dataStr = dataLines.join("");
  if (!dataStr) return { type, data: null };
  try {
    return { type, data: JSON.parse(dataStr) };
  } catch {
    return { type, data: null };
  }
}

function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
