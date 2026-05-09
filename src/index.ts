import { Env } from "./types";
import { ClaudeMessage } from "./lib/claude";
import { CHARACTER_SHEETS, isEmployeeId } from "./lib/employees";
import { generateReportFromChat, BriefingShape } from "./lib/digest";

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
      return ceoStub.fetch(
        new Request(`http://do${subpath}`, {
          method: request.method,
          headers: request.headers,
          body: request.body,
        }),
      );
    }

    // ── Project list (GET) ──────────────────────────────────────────
    if (path === "/api/projects" && request.method === "GET") {
      const result = await env.DB.prepare(
        `SELECT p.id, p.name, p.status,
                p.repo_path AS repoPath,
                p.created_at AS createdAt,
                b.goal, b.state,
                b.next_move AS nextMove,
                b.why,
                b.updated_at AS briefingUpdatedAt
         FROM projects p
         LEFT JOIN briefings b ON p.id = b.project_id
         ORDER BY p.created_at DESC`,
      ).all();
      return json(result.results);
    }

    // ── Project create (POST) ───────────────────────────────────────
    if (path === "/api/projects" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as {
        name?: string;
        repoPath?: string;
        initialGoal?: string;
      } | null;
      if (!body?.name?.trim()) return json({ error: "Missing 'name'" }, 400);

      const id = crypto.randomUUID();
      const goal = body.initialGoal?.trim() ?? "";
      const state = "Just started. No work done yet.";
      const next_move = goal
        ? "Decide who to cast first."
        : "Define the goal and decide who to assign first.";
      // Why is left empty on creation; the first real report will fill it in
      // through the briefing-update flow.
      const why = "";

      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO projects (id, name, repo_path) VALUES (?, ?, ?)",
        ).bind(id, body.name.trim(), body.repoPath ?? null),
        env.DB.prepare(
          "INSERT INTO briefings (project_id, goal, state, next_move, why) VALUES (?, ?, ?, ?, ?)",
        ).bind(id, goal, state, next_move, why),
      ]);

      const created = await env.DB.prepare(
        `SELECT p.id, p.name, p.status,
                p.repo_path AS repoPath,
                p.created_at AS createdAt,
                b.goal, b.state,
                b.next_move AS nextMove,
                b.why,
                b.updated_at AS briefingUpdatedAt
         FROM projects p
         LEFT JOIN briefings b ON b.project_id = p.id
         WHERE p.id = ?`,
      )
        .bind(id)
        .first();
      return json(created, 201);
    }

    // ── Single project GET (bare /api/projects/:id) ─────────────────
    // Must come before the with-subpath regex below, which requires a subpath.
    const projectIdMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projectIdMatch && request.method === "GET") {
      const projectId = projectIdMatch[1];
      const project = await env.DB.prepare(
        `SELECT p.id, p.name, p.status,
                p.repo_path AS repoPath,
                p.created_at AS createdAt,
                b.goal, b.state,
                b.next_move AS nextMove,
                b.why,
                b.updated_at AS briefingUpdatedAt
         FROM projects p
         LEFT JOIN briefings b ON b.project_id = p.id
         WHERE p.id = ?`,
      )
        .bind(projectId)
        .first();
      if (!project) return json({ error: "project not found" }, 404);
      return json(project);
    }

    // ── Project routes with subpath: /api/projects/:id/<subpath> ────
    const projectMatch = path.match(/^\/api\/projects\/([^/]+)(\/.+)$/);
    if (projectMatch) {
      const [, projectId, subpath] = projectMatch;
      const doId = env.PROJECT_DO.idFromName(projectId);
      const stub = env.PROJECT_DO.get(doId);
      // DOs accessed by idFromName can't recover their own name — pass via header.
      const headers = new Headers(request.headers);
      headers.set("X-Project-Id", projectId);
      return stub.fetch(
        new Request(`http://do${subpath}`, {
          method: request.method,
          headers,
          body: request.body,
        }),
      );
    }

    // ── Employee routes: /api/employees/:id/... ─────────────────────
    const employeeMatch = path.match(/^\/api\/employees\/([^/]+)(\/.*)?$/);
    if (employeeMatch) {
      const [, employeeId, subpath] = employeeMatch;
      const doId = env.EMPLOYEE_DO.idFromName(employeeId);
      const stub = env.EMPLOYEE_DO.get(doId);
      const headers = new Headers(request.headers);
      headers.set("X-Employee-Id", employeeId);
      return stub.fetch(
        new Request(`http://do${subpath || "/"}`, {
          method: request.method,
          headers,
          body: request.body,
        }),
      );
    }

    // ── Wrap chat: POST /api/chats/:chatId/wrap ─────────────────────
    const wrapMatch = path.match(/^\/api\/chats\/([^/]+)\/wrap$/);
    if (wrapMatch && request.method === "POST") {
      return handleWrapChat(env, wrapMatch[1]);
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

/**
 * Wrap an active chat — generate a report (employee + project chats only),
 * file it through the Project DO's /report flow, and mark the chat wrapped.
 *
 * CEO and scratch chats just get marked wrapped with no report flow in v0.
 */
async function handleWrapChat(env: Env, chatId: string): Promise<Response> {
  const chat = await env.DB.prepare(
    "SELECT id, project_id, employee_id, status FROM chats WHERE id = ?",
  )
    .bind(chatId)
    .first<{
      id: string;
      project_id: string | null;
      employee_id: string | null;
      status: string;
    }>();
  if (!chat) return json({ error: "chat not found" }, 404);
  if (chat.status === "wrapped") return json({ error: "chat already wrapped" }, 400);

  // CEO/scratch chats — no report flow yet; just mark wrapped.
  if (!chat.project_id || !chat.employee_id || !isEmployeeId(chat.employee_id)) {
    await env.DB.prepare("UPDATE chats SET status = 'wrapped' WHERE id = ?")
      .bind(chatId)
      .run();
    return json({
      wrapped: true,
      no_report: true,
      reason: "CEO or scratch chat — no report flow in v0",
    });
  }

  const employeeId = chat.employee_id;
  const character = CHARACTER_SHEETS[employeeId];

  const briefing = await env.DB.prepare(
    "SELECT goal, state, next_move, why FROM briefings WHERE project_id = ?",
  )
    .bind(chat.project_id)
    .first<BriefingShape>();

  const { results: msgs } = await env.DB.prepare(
    "SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC, id ASC",
  )
    .bind(chatId)
    .all<{ role: string; content: string }>();
  const history: ClaudeMessage[] = msgs
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  if (history.length === 0) {
    return json({ error: "chat has no history to report on" }, 400);
  }

  const reportPartial = await generateReportFromChat(
    character.sheet,
    briefing,
    history,
    env.ANTHROPIC_API_KEY,
  );
  if (!reportPartial) {
    return json({ error: "failed to generate report from chat" }, 502);
  }

  const fullReport = { from_employee: employeeId, ...reportPartial };

  // POST to project DO /report — kicks off persist + briefing update + ping + CEO ingest.
  const projectStub = env.PROJECT_DO.get(env.PROJECT_DO.idFromName(chat.project_id));
  const reportResp = await projectStub.fetch(
    new Request("http://do/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Project-Id": chat.project_id,
      },
      body: JSON.stringify(fullReport),
    }),
  );
  if (!reportResp.ok) {
    const text = await reportResp.text().catch(() => "");
    return json({ error: "project DO rejected report", details: text }, 502);
  }
  const reportResult = (await reportResp.json()) as {
    report_id: string;
    briefing: BriefingShape;
    ping: { summary: string; signal: string } | null;
  };

  await env.DB.prepare("UPDATE chats SET status = 'wrapped' WHERE id = ?")
    .bind(chatId)
    .run();

  return json({
    wrapped: true,
    report: { id: reportResult.report_id, ...fullReport },
    briefing: reportResult.briefing,
    ping: reportResult.ping,
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
