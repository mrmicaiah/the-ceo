import { Env, Briefing, Report } from "../types";
import {
  updateBriefingFromReport,
  summarizeReportAsPing,
  BriefingShape,
  ReportShape,
} from "../lib/digest";

export class ProjectDO implements DurableObject {
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
      case "/briefing":
        if (request.method === "GET") return this.getBriefing(projectId);
        if (request.method === "PUT") return this.updateBriefing(request, projectId);
        return new Response("Method not allowed", { status: 405 });
      case "/briefing-update":
        if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
        return this.updateBriefingField(request, projectId);
      case "/report":
        if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
        return this.fileReport(request, projectId);
      case "/chat":
        return this.handleChatStub();
      case "/execution/queue":
        return this.queueExecutionStub();
      case "/execution/status":
        return this.executionStatusStub();
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  // ── Briefing ──────────────────────────────────────────────────────────────

  private async getBriefing(projectId: string): Promise<Response> {
    const row = await this.env.DB.prepare(
      `SELECT goal, state,
              next_move AS nextMove,
              why,
              updated_at AS updatedAt
       FROM briefings WHERE project_id = ?`,
    )
      .bind(projectId)
      .first<Briefing>();
    if (!row) {
      return jsonResponse({ error: "briefing not found" }, 404);
    }
    return jsonResponse(row);
  }

  /**
   * Partial update — accepts a camelCase subset of {goal, state, nextMove, why}
   * and updates only the provided fields. updated_at always bumps.
   */
  private async updateBriefing(request: Request, projectId: string): Promise<Response> {
    const body = (await request.json().catch(() => null)) as Partial<Briefing> | null;
    if (!body || typeof body !== "object") {
      return jsonResponse({ error: "invalid body" }, 400);
    }

    // [SQL column, value] tuples — column names stay snake_case for SQL.
    const fields: Array<[string, string]> = [];
    if (typeof body.goal === "string") fields.push(["goal", body.goal]);
    if (typeof body.state === "string") fields.push(["state", body.state]);
    if (typeof body.nextMove === "string") fields.push(["next_move", body.nextMove]);
    if (typeof body.why === "string") fields.push(["why", body.why]);

    if (fields.length === 0) {
      return jsonResponse({ error: "no updatable fields provided" }, 400);
    }

    const setClauses = fields.map(([col]) => `${col} = ?`);
    setClauses.push("updated_at = datetime('now')");
    const sql = `UPDATE briefings SET ${setClauses.join(", ")} WHERE project_id = ?`;
    const values = fields.map(([, v]) => v);

    await this.env.DB.prepare(sql)
      .bind(...values, projectId)
      .run();

    const updated = await this.env.DB.prepare(
      `SELECT goal, state,
              next_move AS nextMove,
              why,
              updated_at AS updatedAt
       FROM briefings WHERE project_id = ?`,
    )
      .bind(projectId)
      .first<Briefing>();
    return jsonResponse(updated);
  }

  /**
   * Single-field briefing update — narrower surface than PUT /briefing. Used
   * by the CEO's update_briefing tool. Body: { field, value }. Field is one
   * of the four camelCase keys; we map to the snake_case column at the SQL
   * boundary.
   */
  private async updateBriefingField(request: Request, projectId: string): Promise<Response> {
    const body = (await request.json().catch(() => null)) as
      | { field?: string; value?: string }
      | null;
    if (!body || typeof body !== "object") {
      return jsonResponse({ error: "invalid body" }, 400);
    }
    if (typeof body.field !== "string" || typeof body.value !== "string") {
      return jsonResponse({ error: "missing 'field' or 'value'" }, 400);
    }

    const columnByField: Record<string, string> = {
      goal: "goal",
      state: "state",
      nextMove: "next_move",
      why: "why",
    };
    const column = columnByField[body.field];
    if (!column) {
      return jsonResponse(
        { error: `invalid field — expected one of goal, state, nextMove, why` },
        400,
      );
    }

    // Verify the project (and its briefing) exists before updating.
    const exists = await this.env.DB.prepare(
      "SELECT project_id FROM briefings WHERE project_id = ?",
    )
      .bind(projectId)
      .first();
    if (!exists) return jsonResponse({ error: "briefing not found" }, 404);

    await this.env.DB.prepare(
      `UPDATE briefings SET ${column} = ?, updated_at = datetime('now') WHERE project_id = ?`,
    )
      .bind(body.value, projectId)
      .run();

    const updated = await this.env.DB.prepare(
      `SELECT goal, state,
              next_move AS nextMove,
              why,
              updated_at AS updatedAt
       FROM briefings WHERE project_id = ?`,
    )
      .bind(projectId)
      .first<Briefing>();
    return jsonResponse(updated);
  }

  // ── Report flow ───────────────────────────────────────────────────────────

  /**
   * Receive a report. The full pipeline:
   *   1. Persist the report row.
   *   2. Ask Claude for an updated briefing; persist if returned.
   *   3. Ask Claude for a one-line ping summary + signal; persist if returned.
   *   4. Fire-and-forget POST to CEO_DO /ingest-ping with the ping.
   *
   * Request body uses camelCase. Returns { report, briefing, ping } all camelCase.
   * Briefing is the post-update snapshot (or pre-update if Claude failed to
   * produce a valid update). Ping may be null.
   */
  private async fileReport(request: Request, projectId: string): Promise<Response> {
    const body = (await request.json().catch(() => null)) as Partial<ReportShape> | null;
    if (!body) return jsonResponse({ error: "invalid body" }, 400);

    if (
      !body.fromEmployee ||
      !["nora", "iris", "theo", "dex"].includes(body.fromEmployee) ||
      typeof body.askedToDo !== "string" ||
      typeof body.whatHappened !== "string" ||
      typeof body.recommendedNextMove !== "string"
    ) {
      return jsonResponse({ error: "missing or invalid required report fields" }, 400);
    }

    // Verify the project exists — FK from reports.project_id requires it.
    const project = await this.env.DB.prepare("SELECT name FROM projects WHERE id = ?")
      .bind(projectId)
      .first<{ name: string }>();
    if (!project) return jsonResponse({ error: "project not found" }, 404);

    const reportShape: ReportShape = {
      fromEmployee: body.fromEmployee,
      parentNodeId: body.parentNodeId ?? null,
      askedToDo: body.askedToDo,
      whatHappened: body.whatHappened,
      artifact: body.artifact ?? null,
      openQuestions: body.openQuestions ?? null,
      recommendedNextMove: body.recommendedNextMove,
    };

    // 1. Persist report. Columns are snake_case.
    const reportId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await this.env.DB.prepare(
      "INSERT INTO reports (id, project_id, from_employee, parent_node_id, asked_to_do, what_happened, artifact, open_questions, recommended_next_move) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        reportId,
        projectId,
        reportShape.fromEmployee,
        reportShape.parentNodeId ?? null,
        reportShape.askedToDo,
        reportShape.whatHappened,
        reportShape.artifact,
        reportShape.openQuestions,
        reportShape.recommendedNextMove,
      )
      .run();

    // 2. Update briefing via Claude. Fall back to current on failure.
    const currentBriefing = await this.env.DB.prepare(
      `SELECT goal, state, next_move AS nextMove, why
       FROM briefings WHERE project_id = ?`,
    )
      .bind(projectId)
      .first<BriefingShape>();
    if (!currentBriefing) {
      return jsonResponse({ error: "briefing missing for project (data corruption)" }, 500);
    }

    const newBriefing = await updateBriefingFromReport(
      currentBriefing,
      reportShape,
      this.env.ANTHROPIC_API_KEY,
    );
    if (newBriefing) {
      await this.env.DB.prepare(
        "UPDATE briefings SET goal = ?, state = ?, next_move = ?, why = ?, updated_at = datetime('now') WHERE project_id = ?",
      )
        .bind(newBriefing.goal, newBriefing.state, newBriefing.nextMove, newBriefing.why, projectId)
        .run();
    }
    const briefingForResponse = newBriefing ?? currentBriefing;

    // Read updatedAt back so the response reflects the actual stored value.
    const updatedRow = await this.env.DB.prepare(
      "SELECT updated_at AS updatedAt FROM briefings WHERE project_id = ?",
    )
      .bind(projectId)
      .first<{ updatedAt: string }>();
    const briefingFull: Briefing = {
      goal: briefingForResponse.goal,
      state: briefingForResponse.state,
      nextMove: briefingForResponse.nextMove,
      why: briefingForResponse.why,
      updatedAt: updatedRow?.updatedAt ?? createdAt,
    };

    // 3. Generate ping via Claude.
    const ping = await summarizeReportAsPing(reportShape, project.name, this.env.ANTHROPIC_API_KEY);
    let pingForResponse: { projectId: string; summary: string; signal: string; createdAt: string } | null = null;
    if (ping) {
      const pingCreatedAt = new Date().toISOString();
      await this.env.DB.prepare(
        "INSERT INTO status_pings (project_id, summary, signal) VALUES (?, ?, ?)",
      )
        .bind(projectId, ping.summary, ping.signal)
        .run();
      pingForResponse = {
        projectId,
        summary: ping.summary,
        signal: ping.signal,
        createdAt: pingCreatedAt,
      };

      // 4. Fire-and-forget ingest-ping to CEO. Pinned via waitUntil if available.
      const ceoStub = this.env.CEO_DO.get(this.env.CEO_DO.idFromName("singleton"));
      const ingestPromise = ceoStub.fetch(
        new Request("http://do/ingest-ping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            projectName: project.name,
            summary: ping.summary,
            signal: ping.signal,
            createdAt: pingCreatedAt,
          }),
        }),
      );
      const wu = (this.state as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil;
      if (typeof wu === "function") wu.call(this.state, ingestPromise);
      else void ingestPromise;
    }

    const reportFull: Report = {
      id: reportId,
      projectId,
      fromEmployee: reportShape.fromEmployee,
      parentNodeId: reportShape.parentNodeId ?? null,
      askedToDo: reportShape.askedToDo,
      whatHappened: reportShape.whatHappened,
      artifact: reportShape.artifact ?? null,
      openQuestions: reportShape.openQuestions ?? null,
      recommendedNextMove: reportShape.recommendedNextMove,
      createdAt,
    };

    return jsonResponse({
      report: reportFull,
      briefing: briefingFull,
      ping: pingForResponse,
    });
  }

  // ── Stubs (kept to preserve existing route surface) ──────────────────────

  private async handleChatStub(): Promise<Response> {
    return jsonResponse({
      stub: true,
      message:
        "Project chat not yet implemented; use /api/employees/:id/chat with projectId in the body.",
    });
  }

  private async queueExecutionStub(): Promise<Response> {
    return jsonResponse({ stub: true, message: "Execution queue not yet implemented" });
  }

  private async executionStatusStub(): Promise<Response> {
    return jsonResponse({ stub: true, active_job: null });
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
