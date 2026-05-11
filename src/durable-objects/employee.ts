import { Env, EmployeeId, Employee } from "../types";
import { handleChatTurn, getStateWaitUntil } from "../lib/chat";
import { CHARACTER_SHEETS, COMPANY_KNOWLEDGE, DEX_TOOLS, isEmployeeId } from "../lib/employees";

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
        // Explicit, scannable, copy-pasteable. Tools that take a project_id
        // (dispatch_claude_code today; others in the future) MUST use this
        // literal UUID rather than inventing one.
        lines.push(`Current project ID: ${projectId}`);
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

        // Dex-only: surface any Claude Code runs he dispatched that have
        // completed since he last spoke. Mark them seen so they don't appear
        // in the system prompt again on his next turn. This closes the
        // dispatch → review loop entirely in conversation.
        if (employeeId === "dex") {
          const unseen = await this.loadAndMarkUnseenJobs(projectId);
          if (unseen.length > 0) {
            lines.push("");
            lines.push("## Claude Code runs you haven't reviewed yet");
            lines.push("");
            lines.push(
              "These ran since your last turn. Speak to them in voice; the user has seen them stream live, but you've just now received the results.",
            );
            for (const job of unseen) {
              lines.push("");
              lines.push(`- **${job.summary}** [${job.status}]`);
              if (job.status === "completed") {
                lines.push(`  - Worker summary: ${job.workerSummary || "(none)"}`);
                lines.push(`  - Diff stat: ${job.diffStat || "(no changes)"}`);
                if (job.diffTruncated) {
                  lines.push("  - (Diff truncated for context — full diff is in the panel.)");
                }
              } else if (job.status === "failed") {
                lines.push(`  - Failed in ${job.failureStage ?? "unknown"} stage: ${job.failureError ?? "no error message"}`);
              }
            }
          }
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

    // Dex-only: append DEX_TOOLS between character sheet and project context.
    // Other employees never see this section — they don't have dispatch yet.
    const toolsBlock = employeeId === "dex" ? `\n\n${DEX_TOOLS}` : "";

    // Order: shared company knowledge → individual voice → (Dex's tools) →
    // project context → assignment → private notes. Company knowledge is
    // universal; the character sheet preserves the voice; tools are
    // employee-specific; project/task context overlays.
    return `${COMPANY_KNOWLEDGE}\n\n${character.sheet}${toolsBlock}${projectBlock}${taskBlock}${notesBlock}`;
  }

  /**
   * Dex-only helper: return any execution_jobs on this project that have
   * completed (or failed) since Dex last spoke (dex_seen_at IS NULL), and
   * mark them seen in the same call so they don't appear twice.
   *
   * Idempotent across re-renders within the same turn — once marked, the
   * row is no longer in the unseen set.
   */
  private async loadAndMarkUnseenJobs(projectId: string): Promise<
    Array<{
      jobId: string;
      summary: string;
      status: string;
      workerSummary: string | null;
      diffStat: string | null;
      diffTruncated: boolean;
      failureError: string | null;
      failureStage: string | null;
    }>
  > {
    const { results } = await this.env.DB.prepare(
      `SELECT id AS jobId,
              summary,
              status,
              diff_summary AS diffSummaryRaw
       FROM execution_jobs
       WHERE project_id = ?
         AND status IN ('completed', 'failed')
         AND dex_seen_at IS NULL
       ORDER BY created_at ASC`,
    )
      .bind(projectId)
      .all<{
        jobId: string;
        summary: string;
        status: string;
        diffSummaryRaw: string | null;
      }>();

    if (results.length === 0) return [];

    const parsed = results.map((row) => {
      let workerSummary: string | null = null;
      let diffStat: string | null = null;
      let diffTruncated = false;
      let failureError: string | null = null;
      let failureStage: string | null = null;
      if (row.diffSummaryRaw) {
        try {
          const obj = JSON.parse(row.diffSummaryRaw) as Record<string, unknown>;
          if (row.status === "completed") {
            workerSummary = typeof obj.summary === "string" ? obj.summary : null;
            diffStat = typeof obj.diffStat === "string" ? obj.diffStat : null;
            diffTruncated = obj.diffTruncated === true;
          } else {
            failureError = typeof obj.error === "string" ? obj.error : null;
            failureStage = typeof obj.stage === "string" ? obj.stage : null;
          }
        } catch {
          // ignore
        }
      }
      return {
        jobId: row.jobId,
        summary: row.summary,
        status: row.status,
        workerSummary,
        diffStat,
        diffTruncated,
        failureError,
        failureStage,
      };
    });

    // Mark these jobs seen so we don't include them again on Dex's next turn.
    const ids = parsed.map((j) => j.jobId);
    const placeholders = ids.map(() => "?").join(", ");
    await this.env.DB.prepare(
      `UPDATE execution_jobs SET dex_seen_at = datetime('now') WHERE id IN (${placeholders})`,
    )
      .bind(...ids)
      .run();

    return parsed;
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
