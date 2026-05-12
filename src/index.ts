import { Env, Briefing, Report } from "./types";
import { ClaudeMessage } from "./lib/claude";
import { CHARACTER_SHEETS, isEmployeeId } from "./lib/employees";
import { generateReportFromChat, BriefingShape } from "./lib/digest";
import { createRepo } from "./lib/github";

// Re-export Durable Object classes so Cloudflare can find them
export { CeoDO } from "./durable-objects/ceo";
export { ProjectDO } from "./durable-objects/project";
export { EmployeeDO } from "./durable-objects/employee";
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
    // /health is open above; SPA asset requests fall through to ASSETS
    // at the bottom of this handler and bypass this check naturally.
    // /api/agent/ws has its own auth (AGENT_TOKEN, not AUTH_TOKEN) handled
    // in the upgrade branch below, so we exempt it here.
    if (path.startsWith("/api/") && path !== "/api/agent/ws") {
      const unauth = assertAuthorized(request, env);
      if (unauth) return unauth;
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

    // ── Cast: POST /api/projects/:projectId/cast ───────────────────
    // Must come before the with-subpath regex below (which forwards to DO).
    const castMatch = path.match(/^\/api\/projects\/([^/]+)\/cast$/);
    if (castMatch && request.method === "POST") {
      return handleCast(env, castMatch[1], request);
    }

    // ── Dispatch Claude Code: POST /api/projects/:id/dispatch-claude-code
    // Same reasoning — must come before the with-subpath forwarder.
    const dispatchMatch = path.match(/^\/api\/projects\/([^/]+)\/dispatch-claude-code$/);
    if (dispatchMatch && request.method === "POST") {
      return handleDispatchClaudeCode(env, dispatchMatch[1], request);
    }

    // ── Handoff: POST /api/projects/:projectId/handoff ─────────────
    // Staff-to-staff handoff (run #8). Mirrors /cast but with from/to
    // semantics — refuses self-handoff. Must come before the subpath
    // forwarder for the same routing reason as /cast.
    const handoffMatch = path.match(/^\/api\/projects\/([^/]+)\/handoff$/);
    if (handoffMatch && request.method === "POST") {
      return handleHandoff(env, handoffMatch[1], request);
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
                employee_id AS employeeId,
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

    // ── Agent websocket (for local agent connection) ────────────────
    // Worker-level auth: validate Bearer AGENT_TOKEN BEFORE forwarding the
    // upgrade to AgentHub. This keeps the DO single-purpose: it just owns
    // the socket and the routing, not the bouncer logic.
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

    // ── Static frontend (served by Cloudflare Workers Assets) ───────
    //
    // If the [assets] binding is configured (it is in production), every
    // non-/api path that wasn't caught above falls through to the built SPA.
    // In wrangler dev where the Vite dev server runs separately on :5173,
    // ASSETS may be missing — in that case the API surface still works
    // and any non-API request returns 404.
    if (env.ASSETS && !path.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // ── Fallback ────────────────────────────────────────────────────
    return new Response("Not found", { status: 404 });
  },
};

/**
 * Cast an employee onto a project. Creates a chat row with the task brief
 * pre-loaded so the Employee DO's system prompt can incorporate it on the
 * first message. The frontend then navigates the user into this chat.
 */
async function handleCast(env: Env, projectId: string, request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    employee?: string;
    task?: string;
    sourceChatId?: string;
  } | null;

  if (!body?.employee || !isEmployeeId(body.employee)) {
    return json({ error: "missing or invalid 'employee'" }, 400);
  }
  if (typeof body.task !== "string" || !body.task.trim()) {
    return json({ error: "missing 'task'" }, 400);
  }

  // Verify project exists — chats.project_id has a FK.
  const project = await env.DB.prepare("SELECT id FROM projects WHERE id = ?")
    .bind(projectId)
    .first<{ id: string }>();
  if (!project) return json({ error: "project not found" }, 404);

  const chatId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO chats (id, project_id, employee_id, parent_chat_id, task_brief) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(chatId, projectId, body.employee, body.sourceChatId ?? null, body.task.trim())
    .run();

  return json({ chatId, employee: body.employee, projectId }, 201);
}

/**
 * Staff-to-staff handoff. Same shape as /cast, different verb: from one
 * named employee to another, with a brief composed in the originating
 * employee's voice. Refuses self-handoff (return 400). The new chat's
 * parent_chat_id points back to the source chat so the audit trail is
 * preserved.
 *
 * Modeled directly on handleCast — the only semantic differences are:
 * 1. We accept fromEmployee/toEmployee instead of just employee.
 * 2. We reject fromEmployee === toEmployee with 400.
 * 3. We use the spec's improved error message format on 404 (mirrors the
 *    hallucination-guard wording from dispatch_claude_code).
 */
async function handleHandoff(env: Env, projectId: string, request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    fromEmployee?: string;
    toEmployee?: string;
    brief?: string;
    sourceChatId?: string;
  } | null;

  if (!body?.fromEmployee || !isEmployeeId(body.fromEmployee)) {
    return json({ error: "missing or invalid 'fromEmployee'" }, 400);
  }
  if (!body?.toEmployee || !isEmployeeId(body.toEmployee)) {
    return json({ error: "missing or invalid 'toEmployee'" }, 400);
  }
  if (body.fromEmployee === body.toEmployee) {
    return json(
      { error: "fromEmployee and toEmployee must differ — self-handoff not allowed" },
      400,
    );
  }
  if (typeof body.brief !== "string" || !body.brief.trim()) {
    return json({ error: "missing 'brief'" }, 400);
  }
  if (typeof body.sourceChatId !== "string" || !body.sourceChatId.trim()) {
    return json({ error: "missing 'sourceChatId'" }, 400);
  }

  const project = await env.DB.prepare("SELECT id FROM projects WHERE id = ?")
    .bind(projectId)
    .first<{ id: string }>();
  if (!project) {
    return json(
      {
        error: `No project found with id ${projectId}. The originating employee may have hallucinated the project ID — check that the project field in the handoff block matches a real project in your portfolio.`,
      },
      404,
    );
  }

  const chatId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO chats (id, project_id, employee_id, parent_chat_id, task_brief) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(chatId, projectId, body.toEmployee, body.sourceChatId.trim(), body.brief.trim())
    .run();

  return json({ chatId, employee: body.toEmployee, projectId }, 201);
}

/**
 * Wrap an active chat — generate a report (employee + project chats only),
 * file it through the Project DO's /report flow, and mark the chat wrapped.
 *
 * CEO and scratch chats just get marked wrapped with no report flow in v0.
 *
 * Response shape: { wrapped, report?, briefing?, ping? } all camelCase.
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
      noReport: true,
      reason: "CEO or scratch chat — no report flow in v0",
    });
  }

  const employeeId = chat.employee_id;
  const character = CHARACTER_SHEETS[employeeId];

  const briefing = await env.DB.prepare(
    `SELECT goal, state, next_move AS nextMove, why
     FROM briefings WHERE project_id = ?`,
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

  const fullReport = { fromEmployee: employeeId, ...reportPartial };

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
    report: Report;
    briefing: Briefing;
    ping: { projectId: string; summary: string; signal: string; createdAt: string } | null;
  };

  await env.DB.prepare("UPDATE chats SET status = 'wrapped' WHERE id = ?")
    .bind(chatId)
    .run();

  return json({
    wrapped: true,
    report: reportResult.report,
    briefing: reportResult.briefing,
    ping: reportResult.ping,
  });
}

/**
 * PATCH /api/projects/:id — partial update of the project row. Accepts
 * { name?, repoPath? }. Both are optional but at least one must be present.
 * Empty string for repoPath is allowed and stored as NULL (the briefing
 * cards render "—" for null/empty), mirroring how create handles it.
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
 * POST /api/github/create-repo — creates a repo under the authenticated
 * user's GitHub account via env.GITHUB_TOKEN. If projectId is provided,
 * also PATCHes that project's repo_path to the new repo's html_url.
 *
 * Defaults to private: true. Only set private:false in the request body
 * to explicitly create a public repo.
 *
 * Returns { name, htmlUrl, cloneUrl, projectId? } on success; structured
 * error otherwise. Surface-level error codes:
 *   - 400 missing/invalid body
 *   - 500 server isn't configured (no GITHUB_TOKEN)
 *   - GitHub error codes propagated (401, 403, 422, etc.)
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

  // Default private; only flip to public when the caller explicitly sets false.
  const isPrivate = body.private !== false;

  const result = await createRepo({
    token: env.GITHUB_TOKEN,
    name: body.name.trim(),
    description: body.description?.trim(),
    isPrivate,
  });

  if (!result.ok) {
    // Map upstream codes to a sane response status.
    const status =
      result.status === 401 ? 502 // upstream auth — server problem from our caller's POV
        : result.status === 422 ? 422
        : result.status === 403 ? 502
        : result.status >= 500 || result.status === 0 ? 502
        : result.status;
    return json({ error: result.message, githubStatus: result.status }, status);
  }

  // Attach to project if requested. repo_path stores the html URL for
  // human-readable display; clone_url stores the .git-suffixed HTTPS URL so
  // the agent can `git clone` without further transformation.
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
 * Persists a job row (status='queued'), then asks AgentHub to dispatch it.
 * AgentHub flips the row to 'running' once it has sent the job over the
 * websocket; if no agent is connected, the row stays 'queued' until the
 * next agent 'ready' message.
 *
 * Body: { summary: string, prompt: string, chatId: string }. summary is the
 * user-facing label; prompt is the full Claude Code instruction; chatId
 * threads the job to Dex's conversation so his next turn sees the result.
 */
async function handleDispatchClaudeCode(
  env: Env,
  projectId: string,
  request: Request,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { summary?: string; prompt?: string; chatId?: string }
    | null;
  if (!body || typeof body.summary !== "string" || typeof body.prompt !== "string" || typeof body.chatId !== "string") {
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
        error: `No project found with id ${projectId}. Dex may have hallucinated the project ID — check that the project field in the dispatch block matches a real project in your portfolio.`,
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

  // Ask AgentHub to dispatch. If no agent is connected, AgentHub returns
  // { status: "queued" } and the row stays queued.
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

/** GET /api/jobs/:id — returns the current persisted snapshot. */
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

  // diff_summary is stored as JSON of {summary, diffStat, diff, diffTruncated}
  // for completed jobs OR {error, stage} for failed jobs. Parse defensively.
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

/** GET /api/jobs/:id/stream — SSE proxy to AgentHub's subscriber fan-out. */
async function handleJobStream(env: Env, jobId: string): Promise<Response> {
  const stub = env.AGENT_HUB_DO.get(env.AGENT_HUB_DO.idFromName("singleton"));
  return stub.fetch(
    new Request(`http://do/subscribe/${encodeURIComponent(jobId)}`, { method: "GET" }),
  );
}

/**
 * Derive the directory name for the local checkout from the clone URL.
 * Mirrors AgentHub's helper — kept duplicated here rather than crossing the
 * DO boundary for a one-line utility.
 */
function deriveRepoName(cloneUrl: string | null, projectName: string): string {
  if (cloneUrl) {
    const m = cloneUrl.match(/\/([^/]+?)(?:\.git)?$/);
    if (m?.[1]) return m[1];
  }
  return projectName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Bearer-token auth for /api/* routes. Compares against env.AUTH_TOKEN, which
 * must be configured as a Worker secret (or in .dev.vars locally). Returns:
 *   - 500 if the server isn't configured — surfaces the misconfig loudly
 *     rather than silently locking everyone out as "unauthorized".
 *   - 401 if the header is missing or doesn't match.
 *   - null if the request is authorized; caller continues.
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
