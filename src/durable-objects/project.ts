import { Env, Briefing } from "../types";
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
      "SELECT goal, state, next_move, why, updated_at FROM briefings WHERE project_id = ?",
    )
      .bind(projectId)
      .first<Briefing>();
    if (!row) {
      return jsonResponse({ error: "briefing not found" }, 404);
    }
    return jsonResponse(row);
  }

  /**
   * Partial update — accepts any subset of {goal, state, next_move, why} and
   * updates only the provided fields. updated_at always bumps.
   */
  private async updateBriefing(request: Request, projectId: string): Promise<Response> {
    const body = (await request.json().catch(() => null)) as Partial<Briefing> | null;
    if (!body || typeof body !== "object") {
      return jsonResponse({ error: "invalid body" }, 400);
    }

    const fields: Array<[string, string]> = [];
    if (typeof body.goal === "string") fields.push(["goal", body.goal]);
    if (typeof body.state === "string") fields.push(["state", body.state]);
    if (typeof body.next_move === "string") fields.push(["next_move", body.next_move]);
    if (typeof body.why === "string") fields.push(["why", body.why]);

    if (fields.length === 0) {
      return jsonResponse({ error: "no updatable fields provided" }, 400);
    }

    const setClauses = fields.map(([k]) => `${k} = ?`);
    setClauses.push("updated_at = datetime('now')");
    const sql = `UPDATE briefings SET ${setClauses.join(", ")} WHERE project_id = ?`;
    const values = fields.map(([, v]) => v);

    await this.env.DB.prepare(sql)
      .bind(...values, projectId)
      .run();

    const updated = await this.env.DB.prepare(
      "SELECT goal, state, next_move, why, updated_at FROM briefings WHERE project_id = ?",
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
   * Returns { report_id, briefing, ping }. Briefing is the post-update snapshot
   * (or pre-update if Claude failed to produce a valid update). Ping may be null.
   */
  private async fileReport(request: Request, projectId: string): Promise<Response> {
    const body = (await request.json().catch(() => null)) as Partial<ReportShape> | null;
    if (!body) return jsonResponse({ error: "invalid body" }, 400);

    if (
      !body.from_employee ||
      !["nora", "iris", "theo", "dex"].includes(body.from_employee) ||
      typeof body.asked_to_do !== "string" ||
      typeof body.what_happened !== "string" ||
      typeof body.recommended_next_move !== "string"
    ) {
      return jsonResponse({ error: "missing or invalid required report fields" }, 400);
    }

    // Verify the project exists — FK from reports.project_id requires it.
    const project = await this.env.DB.prepare("SELECT name FROM projects WHERE id = ?")
      .bind(projectId)
      .first<{ name: string }>();
    if (!project) return jsonResponse({ error: "project not found" }, 404);

    const reportShape: ReportShape = {
      from_employee: body.from_employee,
      asked_to_do: body.asked_to_do,
      what_happened: body.what_happened,
      artifact: body.artifact ?? null,
      open_questions: body.open_questions ?? null,
      recommended_next_move: body.recommended_next_move,
    };

    // 1. Persist report.
    const reportId = crypto.randomUUID();
    await this.env.DB.prepare(
      "INSERT INTO reports (id, project_id, from_employee, parent_node_id, asked_to_do, what_happened, artifact, open_questions, recommended_next_move) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        reportId,
        projectId,
        reportShape.from_employee,
        body.parent_node_id ?? null,
        reportShape.asked_to_do,
        reportShape.what_happened,
        reportShape.artifact,
        reportShape.open_questions,
        reportShape.recommended_next_move,
      )
      .run();

    // 2. Update briefing via Claude. Fall back to current on failure.
    const currentBriefing = await this.env.DB.prepare(
      "SELECT goal, state, next_move, why FROM briefings WHERE project_id = ?",
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
        .bind(newBriefing.goal, newBriefing.state, newBriefing.next_move, newBriefing.why, projectId)
        .run();
    }
    const briefingForResponse = newBriefing ?? currentBriefing;

    // 3. Generate ping via Claude.
    const ping = await summarizeReportAsPing(reportShape, project.name, this.env.ANTHROPIC_API_KEY);
    if (ping) {
      await this.env.DB.prepare(
        "INSERT INTO status_pings (project_id, summary, signal) VALUES (?, ?, ?)",
      )
        .bind(projectId, ping.summary, ping.signal)
        .run();

      // 4. Fire-and-forget ingest-ping to CEO. Pinned via waitUntil if available.
      const ceoStub = this.env.CEO_DO.get(this.env.CEO_DO.idFromName("singleton"));
      const ingestPromise = ceoStub.fetch(
        new Request("http://do/ingest-ping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            project_name: project.name,
            summary: ping.summary,
            signal: ping.signal,
            created_at: new Date().toISOString(),
          }),
        }),
      );
      const wu = (this.state as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil;
      if (typeof wu === "function") wu.call(this.state, ingestPromise);
      else void ingestPromise;
    }

    return jsonResponse({
      report_id: reportId,
      briefing: briefingForResponse,
      ping: ping ?? null,
    });
  }

  // ── Stubs (kept to preserve existing route surface) ──────────────────────

  private async handleChatStub(): Promise<Response> {
    return jsonResponse({
      stub: true,
      message:
        "Project chat not yet implemented; use /api/employees/:id/chat with project_id in the body.",
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
