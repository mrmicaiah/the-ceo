// Worker entry — v2 routing surface.
//
// Routes:
//   GET  /health                                — open, no auth
//   GET  /api/projects                          — list projects
//   POST /api/projects                          — create project + briefing
//   GET  /api/projects/:id                      — single-project read
//   PATCH /api/projects/:id                     — name / repo_path
//   GET  /api/projects/:id/briefing             — briefing read (delegates ProjectDO)
//   POST /api/projects/:id/briefing-update      — single-field briefing update
//   POST /api/projects/:id/manager/chat         — streamed turn with this project's manager
//   GET  /api/projects/:id/manager-chat         — resolve canonical manager chat (idempotent)
//   POST /api/projects/:id/dispatch-claude-code — queue a Claude Code worker job
//   GET  /api/jobs/:id                          — snapshot of a job
//   GET  /api/jobs/:id/stream                   — SSE stream of a job
//   POST /api/dropnotes                         — capture a dropnote
//   GET  /api/dropnotes                         — list unarchived dropnotes
//   GET  /api/chats/:id                         — chat metadata + message history
//   POST /api/github/create-repo                — provision a GitHub repo
//   WS   /api/agent/ws                          — agent websocket (AGENT_TOKEN auth)
//
// All /api/* requires Bearer AUTH_TOKEN except /api/agent/ws (which uses
// AGENT_TOKEN). /health is open. Everything else falls through to ASSETS for
// the SPA.
//
// v2 retirements from v1:
//   - /api/ceo/*                       (CEO surface gone; Brainstorm Room later)
//   - /api/projects/:id/cast           (no more casting; one manager per project)
//   - /api/projects/:id/handoff        (no more handoffs)
//   - /api/chats/:id/wrap              (parked for now)
//   - /api/employees/:id/*             (no per-employee identity)

import { Env } from "./types";
import { createRepo } from "./lib/github";

// Re-export Durable Object classes so Cloudflare can find them
export { ProjectDO } from "./durable-objects/project";
export { ManagerDO } from "./durable-objects/manager";
export { AgentHubDO } from "./durable-objects/agent-hub";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ── Health check (unauthenticated) ──────────────────────────────
    if (path === "/health") {
      return json({ status: "ok" });
    }

    // ── Auth gate for /api/* ────────────────────────────────────────
    if (path.startsWith("/api/") && path !== "/api/agent/ws") {
      const unauth = assertAuthorized(request, env);
      if (unauth) return unauth;
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
        ? "Decide the first concrete move toward the goal."
        : "Define the goal and decide the first move.";
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

    // ── Dispatch Claude Code: POST /api/projects/:id/dispatch-claude-code
    // Must come before the subpath forwarder below.
    const dispatchMatch = path.match(/^\/api\/projects\/([^/]+)\/dispatch-claude-code$/);
    if (dispatchMatch && request.method === "POST") {
      return handleDispatchClaudeCode(env, dispatchMatch[1], request);
    }

    // ── Manager chat turn: POST /api/projects/:id/manager/chat ─────
    const managerChatMatch = path.match(/^\/api\/projects\/([^/]+)\/manager\/chat$/);
    if (managerChatMatch && request.method === "POST") {
      return forwardToManager(env, managerChatMatch[1], "/chat", request);
    }

    // ── Manager chat resolve: GET /api/projects/:id/manager-chat ───
    // Idempotent — finds or creates this project's canonical manager chat
    // and returns { chatId, projectId, created }.
    const managerResolveMatch = path.match(/^\/api\/projects\/([^/]+)\/manager-chat$/);
    if (managerResolveMatch && request.method === "GET") {
      return forwardToManager(env, managerResolveMatch[1], "/manager-chat", request);
    }

    // ── Single project GET / PATCH (bare /api/projects/:id) ────────
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
    if (projectIdMatch && request.method === "PATCH") {
      return handlePatchProject(env, projectIdMatch[1], request);
    }

    // ── GitHub: POST /api/github/create-repo ────────────────────────
    if (path === "/api/github/create-repo" && request.method === "POST") {
      return handleCreateRepo(env, request);
    }

    // ── Dropnotes ───────────────────────────────────────────────────
    if (path === "/api/dropnotes" && request.method === "POST") {
      return handleCreateDropnote(env, request);
    }
    if (path === "/api/dropnotes" && request.method === "GET") {
      return handleListDropnotes(env);
    }

    // ── Project routes with subpath: /api/projects/:id/<subpath> ────
    // Delegates to ProjectDO for /briefing and /briefing-update only;
    // every other subpath (cast, handoff, dispatch, manager) is matched
    // above so this never accidentally absorbs them.
    const projectMatch = path.match(/^\/api\/projects\/([^/]+)(\/.+)$/);
    if (projectMatch) {
      const [, projectId, subpath] = projectMatch;
      const doId = env.PROJECT_DO.idFromName(projectId);
      const stub = env.PROJECT_DO.get(doId);
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

    // ── Job snapshot: GET /api/jobs/:id ─────────────────────────────
    const jobIdMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobIdMatch && request.method === "GET") {
      return handleGetJob(env, jobIdMatch[1]);
    }

    // ── Job live stream: GET /api/jobs/:id/stream (SSE) ─────────────
    const jobStreamMatch = path.match(/^\/api\/jobs\/([^/]+)\/stream$/);
    if (jobStreamMatch && request.method === "GET") {
      return handleJobStream(env, jobStreamMatch[1]);
    }

    // ── Get chat metadata + messages: GET /api/chats/:chatId ────────
    const chatMatch = path.match(/^\/api\/chats\/([^/]+)$/);
    if (chatMatch && request.method === "GET") {
      const chatId = chatMatch[1];
      const chat = await env.DB.prepare(
        `SELECT id,
                project_id AS projectId,
                parent_chat_id AS parentChatId,
                status,
                task_brief AS taskBrief,
                created_at AS createdAt
         FROM chats WHERE id = ?`,
      )
        .bind(chatId)
        .first();
      if (!chat) return json({ error: "chat not found" }, 404);

      const { results: messages } = await env.DB.prepare(
        `SELECT id,
                chat_id AS chatId,
                role,
                content,
                created_at AS createdAt
         FROM messages WHERE chat_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
        .bind(chatId)
        .all();
      return json({ ...chat, messages });
    }

    // ── Agent websocket ─────────────────────────────────────────────
    if (path === "/api/agent/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket upgrade", { status: 426 });
      }
      if (!env.AGENT_TOKEN) {
        return new Response("AGENT_TOKEN not configured on server", { status: 500 });
      }
      const auth = request.headers.get("Authorization") ?? "";
      const m = auth.match(/^Bearer\s+(.+)$/);
      if (!m || m[1] !== env.AGENT_TOKEN) {
        return new Response("unauthorized", { status: 401 });
      }
      const stub = env.AGENT_HUB_DO.get(env.AGENT_HUB_DO.idFromName("singleton"));
      return stub.fetch(
        new Request("http://do/connect", {
          method: request.method,
          headers: request.headers,
        }),
      );
    }

    // ── Static frontend (Cloudflare Workers Assets) ─────────────────
    if (env.ASSETS && !path.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};

/**
 * Forward a request to this project's ManagerDO with X-Project-Id set.
 * Used by both the chat turn (POST /chat) and the resolve endpoint
 * (GET /manager-chat).
 */
async function forwardToManager(
  env: Env,
  projectId: string,
  doPath: string,
  request: Request,
): Promise<Response> {
  // Verify the project exists before forwarding — gives a clean 404 rather
  // than letting the DO compose an uncontextualized prompt.
  const project = await env.DB.prepare("SELECT id FROM projects WHERE id = ?")
    .bind(projectId)
    .first<{ id: string }>();
  if (!project) {
    return json(
      {
        error: `No project found with id ${projectId}. Check that the project field matches a real project in your portfolio.`,
      },
      404,
    );
  }

  const doId = env.MANAGER_DO.idFromName(projectId);
  const stub = env.MANAGER_DO.get(doId);
  const headers = new Headers(request.headers);
  headers.set("X-Project-Id", projectId);
  return stub.fetch(
    new Request(`http://do${doPath}`, {
      method: request.method,
      headers,
      body: request.body,
    }),
  );
}

/**
 * PATCH /api/projects/:id — partial update of the project row. Accepts
 * { name?, repoPath? }. Empty string for repoPath stores NULL.
 */
async function handlePatchProject(
  env: Env,
  projectId: string,
  request: Request,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { name?: string; repoPath?: string }
    | null;
  if (!body || typeof body !== "object") {
    return json({ error: "invalid body" }, 400);
  }

  const fields: Array<[string, string | null]> = [];
  if (typeof body.name === "string" && body.name.trim()) {
    fields.push(["name", body.name.trim()]);
  }
  if (typeof body.repoPath === "string") {
    const v = body.repoPath.trim();
    fields.push(["repo_path", v.length ? v : null]);
  }
  if (fields.length === 0) {
    return json({ error: "no updatable fields provided" }, 400);
  }

  const exists = await env.DB.prepare("SELECT id FROM projects WHERE id = ?")
    .bind(projectId)
    .first();
  if (!exists) return json({ error: "project not found" }, 404);

  const setClauses = fields.map(([col]) => `${col} = ?`).join(", ");
  const values = fields.map(([, v]) => v);
  await env.DB.prepare(`UPDATE projects SET ${setClauses} WHERE id = ?`)
    .bind(...values, projectId)
    .run();

  const updated = await env.DB.prepare(
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
  return json(updated);
}

/**
 * POST /api/github/create-repo — creates a GitHub repo via env.GITHUB_TOKEN.
 * If projectId is provided, PATCHes the project's repo_path + clone_url.
 */
async function handleCreateRepo(env: Env, request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | {
        name?: string;
        description?: string;
        private?: boolean;
        projectId?: string;
      }
    | null;
  if (!body?.name || typeof body.name !== "string" || !body.name.trim()) {
    return json({ error: "missing 'name'" }, 400);
  }

  if (!env.GITHUB_TOKEN) {
    return json({ error: "GITHUB_TOKEN not configured on server" }, 500);
  }

  const isPrivate = body.private !== false;

  const result = await createRepo({
    token: env.GITHUB_TOKEN,
    name: body.name.trim(),
    description: body.description?.trim(),
    isPrivate,
  });

  if (!result.ok) {
    const status =
      result.status === 401 ? 502
        : result.status === 422 ? 422
        : result.status === 403 ? 502
        : result.status >= 500 || result.status === 0 ? 502
        : result.status;
    return json({ error: result.message, githubStatus: result.status }, status);
  }

  const projectId = body.projectId?.trim();
  if (projectId) {
    const exists = await env.DB.prepare("SELECT id FROM projects WHERE id = ?")
      .bind(projectId)
      .first();
    if (exists) {
      await env.DB.prepare(
        "UPDATE projects SET repo_path = ?, clone_url = ? WHERE id = ?",
      )
        .bind(result.htmlUrl, result.cloneUrl, projectId)
        .run();
    }
  }

  return json(
    {
      name: result.name,
      htmlUrl: result.htmlUrl,
      cloneUrl: result.cloneUrl,
      projectId: projectId ?? undefined,
    },
    201,
  );
}

/**
 * POST /api/projects/:projectId/dispatch-claude-code
 *
 * Body: { summary, prompt, chatId }. Persists a job row (status='queued'),
 * asks AgentHub to dispatch; if no agent is connected, AgentHub returns
 * { status: "queued" } and the row stays queued.
 */
async function handleDispatchClaudeCode(
  env: Env,
  projectId: string,
  request: Request,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { summary?: string; prompt?: string; chatId?: string }
    | null;
  if (
    !body ||
    typeof body.summary !== "string" ||
    typeof body.prompt !== "string" ||
    typeof body.chatId !== "string"
  ) {
    return json({ error: "missing summary, prompt, or chatId" }, 400);
  }
  if (!body.summary.trim() || !body.prompt.trim() || !body.chatId.trim()) {
    return json({ error: "summary, prompt, and chatId must be non-empty" }, 400);
  }

  const project = await env.DB.prepare(
    `SELECT id, name, clone_url AS cloneUrl FROM projects WHERE id = ?`,
  )
    .bind(projectId)
    .first<{ id: string; name: string; cloneUrl: string | null }>();
  if (!project) {
    return json(
      {
        error: `No project found with id ${projectId}. The manager may have hallucinated the project ID — check that the project field in the dispatch block matches a real project in your portfolio.`,
      },
      404,
    );
  }

  const jobId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO execution_jobs (id, project_id, chat_id, prompt, summary, status)
     VALUES (?, ?, ?, ?, ?, 'queued')`,
  )
    .bind(jobId, projectId, body.chatId.trim(), body.prompt.trim(), body.summary.trim())
    .run();

  const stub = env.AGENT_HUB_DO.get(env.AGENT_HUB_DO.idFromName("singleton"));
  const dispatchResp = await stub.fetch(
    new Request("http://do/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        repoName: deriveRepoName(project.cloneUrl, project.name),
        cloneUrl: project.cloneUrl,
        prompt: body.prompt.trim(),
        projectId,
        chatId: body.chatId.trim(),
      }),
    }),
  );
  const dispatchResult = (await dispatchResp.json().catch(() => ({}))) as {
    status?: string;
  };

  return json(
    {
      jobId,
      status: dispatchResult.status ?? "queued",
      projectId,
    },
    201,
  );
}

/** GET /api/jobs/:id — current persisted snapshot. */
async function handleGetJob(env: Env, jobId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT id,
            project_id AS projectId,
            chat_id AS chatId,
            prompt,
            summary,
            status,
            output_stream AS outputStream,
            diff_summary AS diffSummaryRaw,
            created_at AS createdAt,
            completed_at AS completedAt
     FROM execution_jobs WHERE id = ?`,
  )
    .bind(jobId)
    .first<{
      id: string;
      projectId: string;
      chatId: string;
      prompt: string;
      summary: string;
      status: string;
      outputStream: string | null;
      diffSummaryRaw: string | null;
      createdAt: string;
      completedAt: string | null;
    }>();
  if (!row) return json({ error: "job not found" }, 404);

  let diff: {
    summary?: string;
    diffStat?: string;
    diff?: string;
    diffTruncated?: boolean;
  } | null = null;
  let failure: { error?: string; stage?: string } | null = null;
  if (row.diffSummaryRaw) {
    try {
      const parsed = JSON.parse(row.diffSummaryRaw) as Record<string, unknown>;
      if (row.status === "failed") {
        failure = parsed as { error?: string; stage?: string };
      } else {
        diff = parsed as {
          summary?: string;
          diffStat?: string;
          diff?: string;
          diffTruncated?: boolean;
        };
      }
    } catch {
      // ignore
    }
  }

  return json({
    id: row.id,
    projectId: row.projectId,
    chatId: row.chatId,
    summary: row.summary,
    prompt: row.prompt,
    status: row.status,
    outputStream: row.outputStream ?? "",
    diff,
    failure,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  });
}

/** GET /api/jobs/:id/stream — SSE proxy via AgentHub. */
async function handleJobStream(env: Env, jobId: string): Promise<Response> {
  const stub = env.AGENT_HUB_DO.get(env.AGENT_HUB_DO.idFromName("singleton"));
  return stub.fetch(
    new Request(`http://do/subscribe/${encodeURIComponent(jobId)}`, { method: "GET" }),
  );
}

// ── Dropnotes ──────────────────────────────────────────────────────

/**
 * POST /api/dropnotes — capture a dropnote. Body { content }. Returns the
 * created record { id, content, createdAt, archivedAt: null }.
 */
async function handleCreateDropnote(env: Env, request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { content?: string } | null;
  if (typeof body?.content !== "string" || !body.content.trim()) {
    return json({ error: "missing 'content'" }, 400);
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO dropnotes (id, content) VALUES (?, ?)",
  )
    .bind(id, body.content.trim())
    .run();
  const row = await env.DB.prepare(
    `SELECT id, content, created_at AS createdAt, archived_at AS archivedAt
     FROM dropnotes WHERE id = ?`,
  )
    .bind(id)
    .first();
  return json(row, 201);
}

/**
 * GET /api/dropnotes — list unarchived dropnotes, newest first.
 */
async function handleListDropnotes(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, content, created_at AS createdAt, archived_at AS archivedAt
     FROM dropnotes
     WHERE archived_at IS NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 100`,
  ).all();
  return json(results);
}

/**
 * Derive a local directory name for the agent's checkout.
 */
function deriveRepoName(cloneUrl: string | null, projectName: string): string {
  if (cloneUrl) {
    const m = cloneUrl.match(/\/([^/]+?)(?:\.git)?$/);
    if (m?.[1]) return m[1];
  }
  return projectName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Bearer-token auth for /api/* routes. 500 if server isn't configured;
 * 401 if missing/bad; null if authorized.
 */
function assertAuthorized(request: Request, env: Env): Response | null {
  if (!env.AUTH_TOKEN) {
    return json({ error: "auth not configured on server" }, 500);
  }
  const header = request.headers.get("Authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/);
  if (!m || m[1] !== env.AUTH_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }
  return null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
