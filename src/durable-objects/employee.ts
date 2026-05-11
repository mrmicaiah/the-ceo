import { Env, EmployeeId, Employee } from "../types";
import { handleChatTurn, getStateWaitUntil } from "../lib/chat";
import { CHARACTER_SHEETS, COMPANY_KNOWLEDGE, isEmployeeId } from "../lib/employees";

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
   * Handle a chat turn. Optional `projectId` in the body activates project
   * casting — the system prompt grows to include the project briefing and
   * this employee's recent reports on it. If a chat row already exists with
   * a non-empty task_brief (set by /cast), that brief is woven in as the
   * assignment.
   */
  private async handleChat(request: Request, employeeId: EmployeeId): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const body = (await request.json().catch(() => null)) as
      | { chatId?: string; message?: string; projectId?: string }
      | null;
    if (!body?.message?.trim()) {
      return new Response("Missing 'message' in body", { status: 400 });
    }

    const chatId = body.chatId ?? crypto.randomUUID();
    const projectId = body.projectId?.trim() || undefined;

    const systemPrompt = await this.buildSystemPrompt(employeeId, projectId, chatId);

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
   * casting block (if cast) → assignment brief from the chat row (if set) →
   * private user notes. Project block carries the current briefing plus this
   * employee's recent reports on the project — so Nora walks into a Project 3
   * chat already knowing what she's done there before. If /cast set a
   * task_brief on the chat row, it appears as the specific assignment.
   */
  private async buildSystemPrompt(
    employeeId: EmployeeId,
    projectId: string | undefined,
    chatId: string,
  ): Promise<string> {
    const character = CHARACTER_SHEETS[employeeId];

    let projectBlock = "";
    if (projectId) {
      const project = await this.env.DB.prepare(
        `SELECT p.name,
                b.goal, b.state,
                b.next_move AS nextMove,
                b.why
         FROM projects p
         LEFT JOIN briefings b ON b.project_id = p.id
         WHERE p.id = ?`,
      )
        .bind(projectId)
        .first<{ name: string; goal: string; state: string; nextMove: string; why: string }>();

      if (project) {
        const { results: reports } = await this.env.DB.prepare(
          `SELECT what_happened AS whatHappened,
                  recommended_next_move AS recommendedNextMove,
                  created_at AS createdAt
           FROM reports
           WHERE project_id = ? AND from_employee = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
        )
          .bind(projectId, employeeId, RECENT_REPORTS_LIMIT)
          .all<{ whatHappened: string; recommendedNextMove: string; createdAt: string }>();

        const lines: string[] = [];
        lines.push(`## You're cast on this project: ${project.name}`);
        lines.push("");
        lines.push("Current briefing:");
        lines.push(`- Goal: ${project.goal || "(not set)"}`);
        lines.push(`- State: ${project.state || "(not set)"}`);
        lines.push(`- Next move: ${project.nextMove || "(not set)"}`);
        lines.push(`- Why: ${project.why || "(not set)"}`);
        lines.push("");
        if (reports.length > 0) {
          lines.push(
            `Your last ${reports.length} report${reports.length === 1 ? "" : "s"} on this project (most recent first):`,
          );
          for (const r of reports) {
            lines.push(
              `- [${r.createdAt}] Did: ${r.whatHappened} | Recommended: ${r.recommendedNextMove}`,
            );
          }
        } else {
          lines.push("You haven't filed any reports on this project yet.");
        }
        projectBlock = `\n\n${lines.join("\n")}`;
      }
    }

    // If the chat row already exists with a task_brief (set by /cast), use it
    // as the assignment. New chats with no prior /cast will have no row yet,
    // which is fine — the SELECT just returns null.
    const chatRow = await this.env.DB.prepare(
      "SELECT task_brief AS taskBrief FROM chats WHERE id = ?",
    )
      .bind(chatId)
      .first<{ taskBrief: string }>();
    const taskBrief = chatRow?.taskBrief?.trim() ?? "";
    const taskBlock = taskBrief
      ? `\n\n## Your specific assignment\n\n${taskBrief}`
      : "";

    const notesRow = await this.env.DB.prepare(
      "SELECT notes FROM employee_notes WHERE employee_id = ?",
    )
      .bind(employeeId)
      .first<{ notes: string }>();
    const userNotes = (notesRow?.notes ?? "").trim();
    const notesBlock = userNotes
      ? `\n\n## Your private notes about your principal (carries across conversations)\n\n${userNotes}`
      : "";

    // Order: shared company knowledge → individual voice → project context →
    // assignment → private notes. Company knowledge is universal; the
    // character sheet preserves the voice; everything else overlays.
    return `${COMPANY_KNOWLEDGE}\n\n${character.sheet}${projectBlock}${taskBlock}${notesBlock}`;
  }

  /** Get the employee's profile (character sheet + role) */
  private async getProfile(employeeId: EmployeeId): Promise<Response> {
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
      characterSheet: character.sheet,
      userNotes: notesRow?.notes ?? "",
    };
    return new Response(JSON.stringify(profile), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Get this employee's accumulated notes about the user */
  private async getNotes(employeeId: EmployeeId): Promise<Response> {
    const row = await this.env.DB.prepare(
      "SELECT notes, updated_at AS updatedAt FROM employee_notes WHERE employee_id = ?",
    )
      .bind(employeeId)
      .first<{ notes: string; updatedAt: string }>();
    return new Response(JSON.stringify(row ?? { notes: "", updatedAt: null }), {
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
