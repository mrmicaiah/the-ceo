import { Env, EmployeeId, Employee } from "../types";
import { handleChatTurn, getStateWaitUntil } from "../lib/chat";
import { CHARACTER_SHEETS, isEmployeeId } from "../lib/employees";

const RECENT_REPORTS_LIMIT = 5;

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
    return isEmployeeId(id) ? id : null;
  }

  /**
   * Handle a chat turn. Optional `project_id` in the body activates project
   * casting — the system prompt grows to include the project briefing and
   * this employee's recent reports on it.
   */
  private async handleChat(request: Request, employeeId: EmployeeId): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const body = (await request.json().catch(() => null)) as
      | { chat_id?: string; message?: string; project_id?: string }
      | null;
    if (!body?.message?.trim()) {
      return new Response("Missing 'message' in body", { status: 400 });
    }

    const chatId = body.chat_id ?? crypto.randomUUID();
    const projectId = body.project_id?.trim() || undefined;

    const systemPrompt = await this.buildSystemPrompt(employeeId, projectId);

    const resp = await handleChatTurn({
      db: this.env.DB,
      chatId,
      systemPrompt,
      userMessage: body.message,
      apiKey: this.env.ANTHROPIC_API_KEY,
      employeeId,
      projectId,
      waitUntil: getStateWaitUntil(this.state),
    });

    // Echo the chat id so the client can reuse it for subsequent turns.
    const headers = new Headers(resp.headers);
    headers.set("X-Chat-Id", chatId);
    return new Response(resp.body, { status: resp.status, headers });
  }

  /**
   * Compose the employee's system prompt. Order: character sheet → project
   * casting block (if cast) → private user notes. Project block carries the
   * current briefing plus this employee's recent reports on the project — so
   * Nora walks into a Project 3 chat already knowing what she's done there
   * before.
   */
  private async buildSystemPrompt(
    employeeId: EmployeeId,
    projectId?: string,
  ): Promise<string> {
    const character = CHARACTER_SHEETS[employeeId];

    let projectBlock = "";
    if (projectId) {
      const project = await this.env.DB.prepare(
        `SELECT p.name, b.goal, b.state, b.next_move, b.why
         FROM projects p
         LEFT JOIN briefings b ON b.project_id = p.id
         WHERE p.id = ?`,
      )
        .bind(projectId)
        .first<{ name: string; goal: string; state: string; next_move: string; why: string }>();

      if (project) {
        const { results: reports } = await this.env.DB.prepare(
          `SELECT what_happened, recommended_next_move, created_at
           FROM reports
           WHERE project_id = ? AND from_employee = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
        )
          .bind(projectId, employeeId, RECENT_REPORTS_LIMIT)
          .all<{ what_happened: string; recommended_next_move: string; created_at: string }>();

        const lines: string[] = [];
        lines.push(`## You're cast on this project: ${project.name}`);
        lines.push("");
        lines.push("Current briefing:");
        lines.push(`- Goal: ${project.goal || "(not set)"}`);
        lines.push(`- State: ${project.state || "(not set)"}`);
        lines.push(`- Next move: ${project.next_move || "(not set)"}`);
        lines.push(`- Why: ${project.why || "(not set)"}`);
        lines.push("");
        if (reports.length > 0) {
          lines.push(
            `Your last ${reports.length} report${reports.length === 1 ? "" : "s"} on this project (most recent first):`,
          );
          for (const r of reports) {
            lines.push(
              `- [${r.created_at}] Did: ${r.what_happened} | Recommended: ${r.recommended_next_move}`,
            );
          }
        } else {
          lines.push("You haven't filed any reports on this project yet.");
        }
        projectBlock = `\n\n${lines.join("\n")}`;
      }
    }

    const notesRow = await this.env.DB.prepare(
      "SELECT notes FROM employee_notes WHERE employee_id = ?",
    )
      .bind(employeeId)
      .first<{ notes: string }>();
    const userNotes = (notesRow?.notes ?? "").trim();
    const notesBlock = userNotes
      ? `\n\n## Your private notes about your principal (carries across conversations)\n\n${userNotes}`
      : "";

    return `${character.sheet}${projectBlock}${notesBlock}`;
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
