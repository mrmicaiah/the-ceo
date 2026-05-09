import { Env } from "./types";

// Re-export Durable Object classes so Cloudflare can find them
export { CeoDO } from "./durable-objects/ceo";
export { ProjectDO } from "./durable-objects/project";
export { EmployeeDO } from "./durable-objects/employee";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ── Health check ────────────────────────────────────────────────
    if (path === "/health") {
      return json({ status: "ok" });
    }

    // ── CEO routes ──────────────────────────────────────────────────
    if (path.startsWith("/api/ceo")) {
      const subpath = path.replace("/api/ceo", "") || "/";
      const ceoId = env.CEO_DO.idFromName("singleton");
      const ceoStub = env.CEO_DO.get(ceoId);
      return ceoStub.fetch(new Request(`http://do${subpath}`, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      }));
    }

    // ── Project routes: /api/projects/:id/... ───────────────────────
    const projectMatch = path.match(/^\/api\/projects\/([^/]+)(\/.*)?$/);
    if (projectMatch) {
      const [, projectId, subpath] = projectMatch;
      const doId = env.PROJECT_DO.idFromName(projectId);
      const stub = env.PROJECT_DO.get(doId);
      return stub.fetch(new Request(`http://do${subpath || "/"}`, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      }));
    }

    // ── Employee routes: /api/employees/:id/... ─────────────────────
    const employeeMatch = path.match(/^\/api\/employees\/([^/]+)(\/.*)?$/);
    if (employeeMatch) {
      const [, employeeId, subpath] = employeeMatch;
      const doId = env.EMPLOYEE_DO.idFromName(employeeId);
      const stub = env.EMPLOYEE_DO.get(doId);
      // Pass employee id to the DO via header — DOs accessed by idFromName
      // can't recover their own name from state, and a header beats stuffing
      // it into the path or the body.
      const headers = new Headers(request.headers);
      headers.set("X-Employee-Id", employeeId);
      return stub.fetch(new Request(`http://do${subpath || "/"}`, {
        method: request.method,
        headers,
        body: request.body,
      }));
    }

    // ── Project list (D1 direct) ────────────────────────────────────
    if (path === "/api/projects" && request.method === "GET") {
      const result = await env.DB.prepare(
        "SELECT p.*, b.goal, b.state, b.next_move, b.why, b.updated_at as briefing_updated_at FROM projects p LEFT JOIN briefings b ON p.id = b.project_id ORDER BY p.created_at DESC"
      ).all();
      return json(result.results);
    }

    if (path === "/api/projects" && request.method === "POST") {
      const body = (await request.json()) as { name: string; repo_path?: string };
      const id = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO projects (id, name, repo_path) VALUES (?, ?, ?)").bind(id, body.name, body.repo_path ?? null),
        env.DB.prepare("INSERT INTO briefings (project_id) VALUES (?)").bind(id),
      ]);
      return json({ id, name: body.name }, 201);
    }

    // ── Agent websocket (for local agent connection) ────────────────
    if (path === "/api/agent/ws") {
      // TODO: upgrade to websocket, handle execution job dispatch/results
      return new Response("WebSocket upgrade not yet implemented", { status: 501 });
    }

    // ── Fallback ────────────────────────────────────────────────────
    return new Response("Not found", { status: 404 });
  },
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
