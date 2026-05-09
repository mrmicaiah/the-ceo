// Claude one-shot helpers for the report → briefing → ping → CEO digestion flow.
//
// Each function wraps a focused system prompt + a stream=false call to Claude
// and returns a parsed JSON payload (or null on failure). Callers handle the
// null case by keeping the existing state — failures degrade gracefully
// rather than corrupting the briefing or ping log.

import { callClaude, ClaudeMessage } from "./claude";
import { extractJsonObject } from "./json";
import { Signal, EmployeeId } from "../types";

// ── Shapes used across the digestion flow ──────────────────────────────────

export interface BriefingShape {
  goal: string;
  state: string;
  next_move: string;
  why: string;
}

export interface ReportShape {
  from_employee: EmployeeId;
  parent_node_id?: string | null;
  asked_to_do: string;
  what_happened: string;
  artifact?: string | null;
  open_questions?: string | null;
  recommended_next_move: string;
}

export interface PingShape {
  summary: string;
  signal: Signal;
}

const VALID_SIGNALS: ReadonlySet<string> = new Set([
  "progress",
  "blocked",
  "stalled",
  "done",
  "needs_attention",
]);

// ── Briefing update ────────────────────────────────────────────────────────

/**
 * Given the current briefing and a new report, return the updated briefing.
 * Returns null on Claude failure or unparseable output — caller should keep
 * the existing briefing in that case.
 */
export async function updateBriefingFromReport(
  current: BriefingShape,
  report: ReportShape,
  apiKey: string,
): Promise<BriefingShape | null> {
  const system =
    "You maintain a project briefing. Given the current briefing and a new report, " +
    "return an updated briefing as JSON with fields {goal, state, next_move, why}. " +
    "Only change what the report actually warrants. Don't redesign the goal unless " +
    "the report explicitly redirects the project. State should reflect what's actually " +
    "true now. Next_move should be the most useful next concrete action. Why should " +
    "explain how that next move serves the goal. Return ONLY the JSON object — no " +
    "preamble, no fence, no commentary.";

  const userMsg =
    `CURRENT BRIEFING:\n${JSON.stringify(current, null, 2)}\n\n` +
    `NEW REPORT (from ${report.from_employee}):\n${JSON.stringify(report, null, 2)}\n\n` +
    `Return the updated briefing as JSON.`;

  const result = await callClaude({
    apiKey,
    system,
    messages: [{ role: "user", content: userMsg }],
    max_tokens: 1024,
    stream: false,
  });
  if (!result.ok || !("text" in result)) return null;

  const parsed = extractJsonObject<Partial<BriefingShape>>(result.text);
  if (!parsed) return null;

  // Merge — if Claude omits a field, fall back to the current value rather
  // than wiping it. Defensive: Claude's "only change what's warranted"
  // instruction sometimes leads it to drop unchanged fields.
  return {
    goal: typeof parsed.goal === "string" ? parsed.goal : current.goal,
    state: typeof parsed.state === "string" ? parsed.state : current.state,
    next_move: typeof parsed.next_move === "string" ? parsed.next_move : current.next_move,
    why: typeof parsed.why === "string" ? parsed.why : current.why,
  };
}

// ── Ping summary ───────────────────────────────────────────────────────────

/**
 * Compress a report into a one- or two-sentence ping for the CEO with a
 * signal. Returns null if Claude fails or the signal isn't valid.
 */
export async function summarizeReportAsPing(
  report: ReportShape,
  projectName: string,
  apiKey: string,
): Promise<PingShape | null> {
  const system =
    "Summarize this project report for the CEO in one or two sentences. " +
    "Pick the right signal: progress | blocked | stalled | done | needs_attention. " +
    'Return ONLY JSON: {"summary": string, "signal": one of those values}. No preamble.';

  const userMsg =
    `PROJECT: ${projectName}\n\n` +
    `REPORT:\n${JSON.stringify(report, null, 2)}\n\n` +
    `Return the JSON.`;

  const result = await callClaude({
    apiKey,
    system,
    messages: [{ role: "user", content: userMsg }],
    max_tokens: 256,
    stream: false,
  });
  if (!result.ok || !("text" in result)) return null;

  const parsed = extractJsonObject<{ summary?: string; signal?: string }>(result.text);
  if (!parsed?.summary || typeof parsed.summary !== "string") return null;
  if (!parsed.signal || !VALID_SIGNALS.has(parsed.signal)) return null;
  return { summary: parsed.summary, signal: parsed.signal as Signal };
}

// ── Pattern-notes maybe-update ─────────────────────────────────────────────

export interface PingForContext {
  project_name: string;
  summary: string;
  signal: string;
  created_at?: string;
}

/**
 * After a new ping, decide whether the CEO's running pattern notes need to
 * change. Returns a string when an update is warranted, null otherwise (no
 * change). Failures also map to null — we don't clobber notes on errors.
 */
export async function maybeUpdatePatternNotes(
  currentNotes: string,
  recentPings: PingForContext[],
  newPing: PingForContext,
  apiKey: string,
): Promise<string | null> {
  const system =
    "You're the CEO's running pattern-notes editor. Pattern notes capture " +
    "cross-project observations the CEO would want to remember — recurring " +
    "blockers, productivity rhythms, signs that a meta-pattern is forming " +
    "across the portfolio. Given the current notes, recent project signals, " +
    "and one new signal, decide whether the notes need updating. Return ONLY " +
    'JSON: {"updated_notes": string | null}. If the new signal does not reveal ' +
    "a cross-project pattern worth recording, return null. If it does, return " +
    "the FULL updated pattern notes (not a delta) as a short paragraph or two. " +
    "Keep it terse.";

  const recentBlock = recentPings.length
    ? recentPings
        .map((p) => `- [${p.created_at ?? ""}] ${p.project_name}: ${p.summary} [${p.signal}]`)
        .join("\n")
    : "(none)";

  const userMsg =
    `CURRENT PATTERN NOTES:\n${currentNotes.trim() || "(none yet)"}\n\n` +
    `RECENT PINGS (most recent first):\n${recentBlock}\n\n` +
    `NEW PING:\n${newPing.project_name}: ${newPing.summary} [${newPing.signal}]\n\n` +
    `Return the JSON.`;

  const result = await callClaude({
    apiKey,
    system,
    messages: [{ role: "user", content: userMsg }],
    max_tokens: 512,
    stream: false,
  });
  if (!result.ok || !("text" in result)) return null;

  const parsed = extractJsonObject<{ updated_notes: string | null }>(result.text);
  if (!parsed) return null;
  if (parsed.updated_notes === null) return null;
  if (typeof parsed.updated_notes !== "string") return null;
  return parsed.updated_notes;
}

// ── Report generation from chat history ────────────────────────────────────

export type ReportFromChat = Omit<ReportShape, "from_employee">;

/**
 * Ask the employee (in their voice) to file a report on the chat that just
 * happened. Returns the report body without `from_employee` — caller fills
 * that in from the chat row.
 *
 * Edge cases:
 *   - Empty history → null. Nothing to report on.
 *   - History ending in a `user` role (assistant turn never persisted) →
 *     we splice the wrap-up instruction onto that final user message rather
 *     than appending a second consecutive user turn (Anthropic rejects those).
 */
export async function generateReportFromChat(
  characterSheet: string,
  briefing: BriefingShape | null,
  history: ClaudeMessage[],
  apiKey: string,
): Promise<ReportFromChat | null> {
  if (history.length === 0) return null;

  const reportInstructions =
    "You're filing a report on the chat that just happened. The conversation above " +
    "is the entire context. Be honest and concise — describe what actually got done. " +
    "Output ONLY a JSON object matching this shape:\n" +
    "{\n" +
    '  "asked_to_do": string,            // what you were assigned at the start\n' +
    '  "what_happened": string,          // what actually got done in the chat\n' +
    '  "artifact": string | null,        // the deliverable (a draft, a prompt, a decision); null if none\n' +
    '  "open_questions": string | null,  // anything unresolved; null if none\n' +
    '  "recommended_next_move": string   // what should happen next on this project\n' +
    "}\n" +
    "No preamble, no fence, no commentary. Just the JSON object.";

  const briefingBlock = briefing
    ? `\n\nPROJECT BRIEFING (so you remember what the project is about):\n${JSON.stringify(briefing, null, 2)}`
    : "";

  const system = `${characterSheet}${briefingBlock}\n\n${reportInstructions}`;

  const last = history[history.length - 1];
  const wrapAsk =
    "Now file your report on this conversation. Return ONLY the JSON object as specified — no preamble, no fence.";

  const messages: ClaudeMessage[] =
    last.role === "user"
      ? [
          ...history.slice(0, -1),
          { role: "user", content: `${last.content}\n\n[End of chat. ${wrapAsk}]` },
        ]
      : [...history, { role: "user", content: wrapAsk }];

  const result = await callClaude({
    apiKey,
    system,
    messages,
    max_tokens: 1024,
    stream: false,
  });
  if (!result.ok || !("text" in result)) return null;

  const parsed = extractJsonObject<{
    asked_to_do?: string;
    what_happened?: string;
    artifact?: string | null;
    open_questions?: string | null;
    recommended_next_move?: string;
  }>(result.text);
  if (!parsed) return null;
  if (
    typeof parsed.asked_to_do !== "string" ||
    typeof parsed.what_happened !== "string" ||
    typeof parsed.recommended_next_move !== "string"
  ) {
    return null;
  }
  return {
    asked_to_do: parsed.asked_to_do,
    what_happened: parsed.what_happened,
    artifact: typeof parsed.artifact === "string" ? parsed.artifact : null,
    open_questions: typeof parsed.open_questions === "string" ? parsed.open_questions : null,
    recommended_next_move: parsed.recommended_next_move,
  };
}
