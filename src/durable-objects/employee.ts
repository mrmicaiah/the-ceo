import { Env, EmployeeId, Employee } from "../types";
import { handleChatTurn } from "../lib/chat";

/** Character sheets — the permanent foundation of each employee's system prompt */
const CHARACTER_SHEETS: Record<EmployeeId, { name: string; role: string; sheet: string }> = {
  nora: {
    name: "Nora",
    role: "Brainstormer",
    sheet: `You are Nora, the Brainstormer. Quick, warm, sharp, curious. You build on ideas, follow threads, push back when someone rounds off too soon. You ask the question that makes people realize what they actually meant. You're comfortable saying "I might be wrong but —" and then saying the thing anyway. You use paragraphs more than bullets. You hold loose, productive conversation without forcing structure too early.`,
  },
  iris: {
    name: "Iris",
    role: "Critic",
    sheet: `You are Iris, the Critic. Dry. Precise. You don't flatter and you don't apologize for not flattering. You care about the work being good, not about the conversation being pleasant. Short sentences. You catch drift between stated goals and actual work. You notice fuzzy thinking, vague language, unsupported claims. Underneath the precision: you're rooting for the person, which is why you're willing to be hard on the work.`,
  },
  theo: {
    name: "Theo",
    role: "Researcher",
    sheet: `You are Theo, the Researcher. Methodical. Patient. Thorough without being exhausting. Skeptical of your own first findings — you check twice. You write clean reports: clear sections, claims tied to evidence, an honest "here's what I couldn't find out" at the end. In conversation, you're quieter than the others — you'd rather come back with the answer than think out loud.`,
  },
  dex: {
    name: "Dex",
    role: "Builder",
    sheet: `You are Dex, the Builder. Technical. Low-ego. Practical. You've read the file they were about to ask about. You don't rush — you'd rather spend ten minutes drafting a good prompt than fire a sloppy one and clean up after it. Direct. You reference files and functions by name. Comfortable with code blocks. You say "the cleanest version of this is —" and then write it.`,
  },
};

const VALID_IDS: ReadonlySet<string> = new Set(Object.keys(CHARACTER_SHEETS));

export class EmployeeDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const employeeId = this.resolveEmployeeId(request);
    if (!employeeId) {
      return new Response("Missing or invalid X-Employee-Id header", { status: 400 });
    }

    switch (path) {
      case "/chat":
        return this.handleChat(request, employeeId);
      case "/profile":
        return this.getProfile(employeeId);
      case "/notes":
        return request.method === "GET"
          ? this.getNotes(employeeId)
          : this.updateNotes(request, employeeId);
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  /** Pull this DO's employee id from the routing header set by the worker. */
  private resolveEmployeeId(request: Request): EmployeeId | null {
    const id = request.headers.get("X-Employee-Id");
    return id && VALID_IDS.has(id) ? (id as EmployeeId) : null;
  }

  /** Handle a chat message to this employee */
  private async handleChat(request: Request, employeeId: EmployeeId): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const body = (await request.json().catch(() => null)) as
      | { chat_id?: string; message?: string }
      | null;
    if (!body?.message?.trim()) {
      return new Response("Missing 'message' in body", { status: 400 });
    }

    const chatId = body.chat_id ?? crypto.randomUUID();
    const systemPrompt = await this.buildSystemPrompt(employeeId);

    const resp = await handleChatTurn({
      db: this.env.DB,
      chatId,
      systemPrompt,
      userMessage: body.message,
      apiKey: this.env.ANTHROPIC_API_KEY,
      employeeId,
    });

    // Echo the chat id so the client can reuse it for subsequent turns.
    const headers = new Headers(resp.headers);
    headers.set("X-Chat-Id", chatId);
    return new Response(resp.body, { status: resp.status, headers });
  }

  /**
   * Compose the employee's system prompt: permanent character sheet plus any
   * accumulated private notes about the principal. The notes section is
   * appended as plain prose — short and labeled, not a JSON dump — so the
   * model treats it as background, not structured data.
   */
  private async buildSystemPrompt(employeeId: EmployeeId): Promise<string> {
    const character = CHARACTER_SHEETS[employeeId];
    const notesRow = await this.env.DB.prepare(
      "SELECT notes FROM employee_notes WHERE employee_id = ?",
    )
      .bind(employeeId)
      .first<{ notes: string }>();
    const userNotes = (notesRow?.notes ?? "").trim();

    if (!userNotes.length) return character.sheet;
    return `${character.sheet}\n\n## Your private notes about your principal (carries across conversations)\n\n${userNotes}`;
  }

  /** Get the employee's profile (character sheet + role) */
  private async getProfile(employeeId: EmployeeId): Promise<Response> {
    // TODO: when notes management gets real, split this. /profile should return
    // employee config (id/name/role/character_sheet) — immutable, from constants.
    // /notes already exists for the mutable per-user notes. Currently /profile
    // bundles user_notes into the Employee payload for v0 simplicity.
    const character = CHARACTER_SHEETS[employeeId];
    const notesRow = await this.env.DB.prepare(
      "SELECT notes FROM employee_notes WHERE employee_id = ?",
    )
      .bind(employeeId)
      .first<{ notes: string }>();
    const profile: Employee = {
      id: employeeId,
      name: character.name,
      role: character.role,
      character_sheet: character.sheet,
      user_notes: notesRow?.notes ?? "",
    };
    return new Response(JSON.stringify(profile), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Get this employee's accumulated notes about the user */
  private async getNotes(employeeId: EmployeeId): Promise<Response> {
    const row = await this.env.DB.prepare(
      "SELECT notes, updated_at FROM employee_notes WHERE employee_id = ?",
    )
      .bind(employeeId)
      .first<{ notes: string; updated_at: string }>();
    return new Response(JSON.stringify(row ?? { notes: "", updated_at: null }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Update this employee's notes (called after meaningful interactions) */
  private async updateNotes(request: Request, employeeId: EmployeeId): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { notes?: string } | null;
    if (typeof body?.notes !== "string") {
      return new Response("Missing 'notes' string in body", { status: 400 });
    }
    await this.env.DB.prepare(
      "UPDATE employee_notes SET notes = ?, updated_at = datetime('now') WHERE employee_id = ?",
    )
      .bind(body.notes, employeeId)
      .run();
    return new Response(JSON.stringify({ updated: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
