// ProjectDO — per-project metadata DO. v2 surface area:
//   GET  /briefing          — read the project's current briefing
//   PUT  /briefing          — partial briefing update (mixed-field)
//   POST /briefing-update   — single-field briefing update (used by the
//                             update_briefing action)
//
// The /report endpoint, chat stub, and execution stubs from v1 have been
// removed in run #9. Wrap is parked and no v2 surface emits reports yet —
// when wrap returns in a later run, /report comes back along with it.

import { Env, Briefing } from "../types";

export class ProjectDO implements DurableObject {
  private env: Env;

  constructor(_state: DurableObjectState, env: Env) {
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
   * Single-field briefing update — narrower surface than PUT /briefing. Body:
   * { field, value }. Field is one of the four camelCase keys; we map to the
   * snake_case column at the SQL boundary.
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
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
