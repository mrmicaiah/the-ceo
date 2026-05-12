// ManagerDO — one DO per project, addressed by projectId.
//
// Every project has exactly one manager. The manager IS the project's chat:
// brainstorm + critique + draft + dispatch + review, all in one continuous
// conversation. There's no per-employee identity; the manager is bound to
// the project's repo via the project context block in its system prompt.
//
// This replaces v1's EmployeeDO. The dispatch_claude_code worker mechanism
// is preserved unchanged. Cast and handoff logic is gone — the manager does
// it all in one chat.

import { Env } from "../types";
import { handleChatTurn, getStateWaitUntil } from "../lib/chat";
import { MANAGER_SYSTEM_PROMPT } from "../lib/manager";

const RECENT_UNSEEN_JOB_LIMIT = 10;

export class ManagerDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const projectId = request.headers.get("X-Project-Id");
    if (!projectId) {
      return new Response("Missing X-Project-Id header", { status: 400 });
    }

    switch (path) {
      case "/chat":
        return this.handleChat(request, projectId);
      case "/manager-chat":
        return this.resolveManagerChat(request, projectId);
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  /**
   * Resolve (or create) the canonical manager chat for this project. Returns
   * { chatId } — the single chat row that represents this project's manager
   * conversation. Idempotent — repeated calls return the same chatId.
   *
   * v2 has exactly one chat per project (the manager chat). We pick the
   * earliest-created chat row for this project as canonical; if none exists,
   * we mint one. The earliest-created rule survives parallel calls across
   * devices: if two clients call this simultaneously and both insert, the
   * next call picks the older row and the system converges. Worst case is
   * a single orphan row, no data loss.
   */
  private async resolveManagerChat(request: Request, projectId: string): Promise<Response> {
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const existing = await this.env.DB.prepare(
      `SELECT id FROM chats
       WHERE project_id = ?
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    )
      .bind(projectId)
      .first<{ id: string }>();
    if (existing) {
      return json({ chatId: existing.id, projectId, created: false });
    }

    const chatId = crypto.randomUUID();
    await this.env.DB.prepare(
      "INSERT INTO chats (id, project_id) VALUES (?, ?)",
    )
      .bind(chatId, projectId)
      .run();
    return json({ chatId, projectId, created: true });
  }

  /**
   * Handle a chat turn for this project's manager. Body shape:
   *   { chatId?, message }
   * If chatId is omitted, the canonical manager chat is resolved (or created).
   * The system prompt is built once per turn from MANAGER_SYSTEM_PROMPT plus
   * a project context block (current project + briefing + unseen worker
   * results).
   */
  private async handleChat(request: Request, projectId: string): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const body = (await request.json().catch(() => null)) as
      | { chatId?: string; message?: string }
      | null;
    if (!body?.message?.trim()) {
      return new Response("Missing 'message' in body", { status: 400 });
    }

    const chatId = body.chatId?.trim() || (await this.ensureCanonicalChat(projectId));

    const systemPrompt = await this.buildSystemPrompt(projectId);

    const resp = await handleChatTurn({
      db: this.env.DB,
      chatId,
      systemPrompt,
      userMessage: body.message,
      apiKey: this.env.ANTHROPIC_API_KEY,
      projectId,
      waitUntil: getStateWaitUntil(this.state),
    });

    const headers = new Headers(resp.headers);
    headers.set("X-Chat-Id", chatId);
    return new Response(resp.body, { status: resp.status, headers });
  }

  /** Inline resolve-or-create for handleChat when no chatId is supplied. */
  private async ensureCanonicalChat(projectId: string): Promise<string> {
    const existing = await this.env.DB.prepare(
      `SELECT id FROM chats
       WHERE project_id = ?
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    )
      .bind(projectId)
      .first<{ id: string }>();
    if (existing) return existing.id;

    const chatId = crypto.randomUUID();
    await this.env.DB.prepare(
      "INSERT INTO chats (id, project_id) VALUES (?, ?)",
    )
      .bind(chatId, projectId)
      .run();
    return chatId;
  }

  /**
   * Compose the manager's system prompt. Order:
   *   MANAGER_SYSTEM_PROMPT
   * + Current project line + project ID line
   * + briefing context (goal/state/nextMove/why if any are set)
   * + recent unseen Claude Code job results (marked seen as a side effect)
   *
   * If briefing fields are all empty, the briefing block is omitted entirely
   * rather than printed as a wall of "(not set)". A manager just starting
   * out on a fresh project doesn't need a stub briefing in the prompt.
   */
  private async buildSystemPrompt(projectId: string): Promise<string> {
    const project = await this.env.DB.prepare(
      `SELECT p.id, p.name,
              b.goal, b.state,
              b.next_move AS nextMove,
              b.why
       FROM projects p
       LEFT JOIN briefings b ON b.project_id = p.id
       WHERE p.id = ?`,
    )
      .bind(projectId)
      .first<{ id: string; name: string; goal: string; state: string; nextMove: string; why: string }>();

    if (!project) {
      // Project doesn't exist (shouldn't happen via normal flow — the route
      // handler verifies, but defensive). Return the bare prompt so the
      // manager can still respond, even if without context.
      return MANAGER_SYSTEM_PROMPT;
    }

    const lines: string[] = [];
    lines.push("");
    lines.push("");
    lines.push(`## Your project`);
    lines.push("");
    lines.push(`Current project: ${project.name}`);
    lines.push(`Current project ID: ${projectId}`);

    const hasBriefing =
      (project.goal || project.state || project.nextMove || project.why || "").trim().length > 0;
    if (hasBriefing) {
      lines.push("");
      lines.push("Current briefing:");
      if (project.goal?.trim()) lines.push(`- Goal: ${project.goal.trim()}`);
      if (project.state?.trim()) lines.push(`- State: ${project.state.trim()}`);
      if (project.nextMove?.trim()) lines.push(`- Next move: ${project.nextMove.trim()}`);
      if (project.why?.trim()) lines.push(`- Why: ${project.why.trim()}`);
    }

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
          lines.push(
            `  - Failed in ${job.failureStage ?? "unknown"} stage: ${job.failureError ?? "no error message"}`,
          );
        }
      }
    }

    return `${MANAGER_SYSTEM_PROMPT}${lines.join("\n")}`;
  }

  /**
   * Read any execution_jobs on this project whose status is terminal and
   * which the manager hasn't seen yet (manager_seen_at IS NULL). Mark them
   * seen in the same transaction so the next prompt build doesn't re-surface
   * them. This is the same mechanism v1 used (under the dex_seen_at name);
   * column was renamed during the v2 migration.
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
         AND manager_seen_at IS NULL
       ORDER BY created_at ASC
       LIMIT ?`,
    )
      .bind(projectId, RECENT_UNSEEN_JOB_LIMIT)
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

    const ids = parsed.map((j) => j.jobId);
    const placeholders = ids.map(() => "?").join(", ");
    await this.env.DB.prepare(
      `UPDATE execution_jobs SET manager_seen_at = datetime('now') WHERE id IN (${placeholders})`,
    )
      .bind(...ids)
      .run();

    return parsed;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
