// Worker entry — v3 routing surface.
//
// v3 (run #10) reshape:
//   - GitHub IS the project list. /api/repos returns the merged
//     (github-list × d1-projects) view with isProject flags.
//   - Claiming a repo: POST /api/projects/from-repo creates a D1 row and
//     scaffolds .ceo/* in the repo.
//   - Creating a new project: POST /api/projects/new creates a new GitHub
//     repo, then claims it (same scaffold + row).
//   - Briefings retired entirely. The manager reads .ceo/* on each chat
//     turn instead of pulling from a D1 briefings table.
//
// Routes:
//   GET  /health                                — open, no auth
//   GET  /api/repos                             — list user repos × d1 (isProject)
//   POST /api/projects/from-repo                — claim an existing repo
//   POST /api/projects/new                      — create repo + claim
//   GET  /api/projects/:id                      — single project read (minimal row)
//   GET  /api/projects/:id/manager-chat         — resolve canonical manager chat
//   POST /api/projects/:id/manager/chat         — streamed manager turn
//   POST /api/projects/:id/dispatch-claude-code — queue a Claude Code worker
//   GET  /api/jobs/:id                          — job snapshot
//   GET  /api/jobs/:id/stream                   — SSE job stream
//   POST /api/dropnotes                         — capture a dropnote
//   GET  /api/dropnotes                         — list unarchived dropnotes
//   GET  /api/chats/:id                         — chat metadata + messages
//   POST /api/github/create-repo                — provision a GitHub repo (legacy
//                                                  surface; /api/projects/new is
//                                                  the preferred path)
//   WS   /api/agent/ws                          — agent websocket (AGENT_TOKEN auth)

import { Env } from "./types";
import {
  createRepo,
  listUserRepos,
  scaffoldCeoDirectory,
} from "./lib/github";

// Re-export Durable Object classes so Cloudflare can find them
export { ManagerDO } from "./durable-objects/manager";
export { AgentHubDO } from "./durable-objects/agent-hub";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") {
      return json({ status: "ok" });
    }

    // Auth gate for /api/* (except /api/agent/ws which uses AGENT_TOKEN).
    if (path.startsWith("/api/") && path !== "/api/agent/ws") {
      const unauth = assertAuthorized(request, env);
      if (unauth) return unauth;
    }

    // ── Repos (GitHub × D1 merged) ──────────────────────────────────
    if (path === "/api/repos" && request.method === "GET") {
      return handleListRepos(env);
    }

    // ── Project creation paths ──────────────────────────────────────
    if (path === "/api/projects/from-repo" && request.method === "POST") {
      return handleClaimFromRepo(env, request);
    }
    if (path === "/api/projects/new" && request.method === "POST") {
      return handleCreateNewProject(env, request);
    }

    // ── Dispatch Claude Code ────────────────────────────────────────
    const dispatchMatch = path.match(/^\/api\/projects\/([^/]+)\/dispatch-claude-code$/);
    if (dispatchMatch && request.method === "POST") {
      return handleDispatchClaudeCode(env, dispatchMatch[1], request);
    }

    // ── Manager chat ────────────────────────────────────────────────
    const managerChatMatch = path.match(/^\/api\/projects\/([^/]+)\/manager\/chat$/);
    if (managerChatMatch && request.method === "POST") {
      return forwardToManager(env, managerChatMatch[1], "/chat", request);
    }
    const managerResolveMatch = path.match(/^\/api\/projects\/([^/]+)\/manager-chat$/);
    if (managerResolveMatch && request.method === "GET") {
      return forwardToManager(env, managerResolveMatch[1], "/manager-chat", request);
    }

    // ── Single project GET ──────────────────────────────────────────
    const projectIdMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projectIdMatch && request.method === "GET") {
      const projectId = projectIdMatch[1];
      const project = await env.DB.prepare(
        `SELECT id,
                repo_full_name AS repoFullName,
                clone_url AS cloneUrl,
                created_at AS createdAt
         FROM projects WHERE id = ?`,
      )
        .bind(projectId)
        .first();
      if (!project) return json({ error: "project not found" }, 404);
      return json(project);
    }

    // ── GitHub create-repo (legacy direct surface) ─────────────────
    if (path === "/api/github/create-repo" && request.method === "POST") {
      return handleCreateRepoLegacy(env, request);
    }

    // ── Dropnotes ───────────────────────────────────────────────────
    if (path === "/api/dropnotes" && request.method === "POST") {
      return handleCreateDropnote(env, request);
    }
    if (path === "/api/dropnotes" && request.method === "GET") {
      return handleListDropnotes(env);
    }

    // ── Diagnostics: GitHub token classification ────────────────────
    // No secret leaves the worker — only the token's class (classic vs
    // fine-grained), scopes (classic) or expiration (fine-grained), and
    // the authenticated user. Behind AUTH_TOKEN like all /api/* routes.
    if (path === "/api/_diag/github-token" && request.method === "GET") {
      return handleDiagGithubToken(env);
    }

    // ── Jobs ────────────────────────────────────────────────────────
    const jobIdMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobIdMatch && request.method === "GET") {
      return handleGetJob(env, jobIdMatch[1]);
    }
    const jobStreamMatch = path.match(/^\/api\/jobs\/([^/]+)\/stream$/);
    if (jobStreamMatch && request.method === "GET") {
      return handleJobStream(env, jobStreamMatch[1]);
    }

    // ── Chats ───────────────────────────────────────────────────────
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

    // ── Static SPA (assets binding) ─────────────────────────────────
    if (env.ASSETS && !path.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};

// ── /api/repos: GitHub list × D1 isProject merge ─────────────────────

interface RepoListItem {
  name: string;
  fullName: string;
  description: string | null;
  cloneUrl: string;
  htmlUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
  updatedAt: string;
  isProject: boolean;
  projectId: string | null;
}

async function handleListRepos(env: Env): Promise<Response> {
  if (!env.GITHUB_TOKEN) {
    return json(
      {
        error:
          "GITHUB_TOKEN not configured on server. v3 needs GitHub access to enumerate your project list.",
      },
      500,
    );
  }

  const result = await listUserRepos(env.GITHUB_TOKEN);
  if (!result.ok) {
    const status = result.status === 401 ? 502 : result.status >= 500 || result.status === 0 ? 502 : result.status;
    return json({ error: result.message, githubStatus: result.status }, status);
  }

  // Pull all D1 projects keyed by repo_full_name.
  const { results: claimedRows } = await env.DB.prepare(
    `SELECT id, repo_full_name AS repoFullName FROM projects`,
  ).all<{ id: string; repoFullName: string }>();
  const claimed = new Map<string, string>();
  for (const row of claimedRows) claimed.set(row.repoFullName, row.id);

  const merged: RepoListItem[] = result.repos.map((r) => ({
    name: r.name,
    fullName: r.fullName,
    description: r.description,
    cloneUrl: r.cloneUrl,
    htmlUrl: r.htmlUrl,
    defaultBranch: r.defaultBranch,
    isPrivate: r.isPrivate,
    updatedAt: r.updatedAt,
    isProject: claimed.has(r.fullName),
    projectId: claimed.get(r.fullName) ?? null,
  }));

  return json(merged);
}

// ── /api/projects/from-repo: claim an existing repo ──────────────────

async function handleClaimFromRepo(env: Env, request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { repoFullName?: string; cloneUrl?: string; defaultBranch?: string }
    | null;
  if (
    typeof body?.repoFullName !== "string" ||
    typeof body.cloneUrl !== "string" ||
    typeof body.defaultBranch !== "string" ||
    !body.repoFullName.trim() ||
    !body.cloneUrl.trim() ||
    !body.defaultBranch.trim()
  ) {
    return json(
      { error: "missing repoFullName, cloneUrl, or defaultBranch" },
      400,
    );
  }

  return claimRepo(env, {
    repoFullName: body.repoFullName.trim(),
    cloneUrl: body.cloneUrl.trim(),
    defaultBranch: body.defaultBranch.trim(),
  });
}

// ── /api/projects/new: create a new GitHub repo + claim it ───────────

async function handleCreateNewProject(env: Env, request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { name?: string; description?: string; private?: boolean }
    | null;
  if (typeof body?.name !== "string" || !body.name.trim()) {
    return json({ error: "missing 'name'" }, 400);
  }
  if (!env.GITHUB_TOKEN) {
    return json({ error: "GITHUB_TOKEN not configured on server" }, 500);
  }

  // Default private; only flip to public when body.private === false.
  const isPrivate = body.private !== false;
  const created = await createRepo({
    token: env.GITHUB_TOKEN,
    name: body.name.trim(),
    description: body.description?.trim(),
    isPrivate,
  });
  if (!created.ok) {
    const status =
      created.status === 422 ? 422
        : created.status === 401 ? 502
        : created.status >= 500 || created.status === 0 ? 502
        : created.status;
    return json({ error: created.message, githubStatus: created.status }, status);
  }

  return claimRepo(env, {
    repoFullName: created.name,
    cloneUrl: created.cloneUrl,
    defaultBranch: created.defaultBranch,
  });
}

/**
 * Shared claim path used by both from-repo and new.
 *
 * If the project already exists (looked up by repo_full_name UNIQUE),
 * returns the existing row with isNew=false. Otherwise inserts a new D1
 * row and scaffolds `.ceo/*` in the repo. Scaffolding failures don't roll
 * back the row — the project is logically claimed even if .ceo/ is
 * partially written; the manager handles missing files gracefully.
 *
 * Race-safe on concurrent claims: if INSERT loses a UNIQUE-race with
 * another claim of the same repo, we re-SELECT and return the winner's
 * row as isNew=false.
 */
async function claimRepo(
  env: Env,
  input: { repoFullName: string; cloneUrl: string; defaultBranch: string },
): Promise<Response> {
  if (!env.GITHUB_TOKEN) {
    return json({ error: "GITHUB_TOKEN not configured on server" }, 500);
  }

  const existing = await env.DB.prepare(
    `SELECT id, repo_full_name AS repoFullName, clone_url AS cloneUrl
     FROM projects WHERE repo_full_name = ?`,
  )
    .bind(input.repoFullName)
    .first<{ id: string; repoFullName: string; cloneUrl: string }>();
  if (existing) {
    return json({
      projectId: existing.id,
      repoFullName: existing.repoFullName,
      cloneUrl: existing.cloneUrl,
      isNew: false,
    });
  }

  const projectId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO projects (id, repo_full_name, clone_url) VALUES (?, ?, ?)`,
    )
      .bind(projectId, input.repoFullName, input.cloneUrl)
      .run();
  } catch (err) {
    // UNIQUE constraint race — somebody else claimed it between our SELECT
    // and our INSERT. Re-SELECT and return their row.
    const conflicted = await env.DB.prepare(
      `SELECT id, repo_full_name AS repoFullName, clone_url AS cloneUrl
       FROM projects WHERE repo_full_name = ?`,
    )
      .bind(input.repoFullName)
      .first<{ id: string; repoFullName: string; cloneUrl: string }>();
    if (conflicted) {
      return json({
        projectId: conflicted.id,
        repoFullName: conflicted.repoFullName,
        cloneUrl: conflicted.cloneUrl,
        isNew: false,
      });
    }
    return json(
      { error: `Failed to claim repo: ${(err as Error).message}` },
      500,
    );
  }

  // Scaffold .ceo/. Failure does not unwind the D1 row — the project is
  // logically claimed. We surface the failure as a warning so the frontend
  // can show it; the manager will degrade gracefully.
  const scaffold = await scaffoldCeoDirectory(
    env.GITHUB_TOKEN,
    input.repoFullName,
    input.defaultBranch,
  );

  if (!scaffold.ok) {
    return json(
      {
        projectId,
        repoFullName: input.repoFullName,
        cloneUrl: input.cloneUrl,
        isNew: true,
        scaffoldingError: scaffold.message,
        scaffoldingPartial: scaffold.partial,
      },
      201,
    );
  }

  if ("alreadyHadCeoDirectory" in scaffold) {
    return json(
      {
        projectId,
        repoFullName: input.repoFullName,
        cloneUrl: input.cloneUrl,
        isNew: true,
        alreadyHadCeoDirectory: true,
      },
      201,
    );
  }

  return json(
    {
      projectId,
      repoFullName: input.repoFullName,
      cloneUrl: input.cloneUrl,
      isNew: true,
    },
    201,
  );
}

// ── Legacy: POST /api/github/create-repo (kept for backward compat) ─

async function handleCreateRepoLegacy(env: Env, request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { name?: string; description?: string; private?: boolean }
    | null;
  if (typeof body?.name !== "string" || !body.name.trim()) {
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
      result.status === 422 ? 422
        : result.status === 401 ? 502
        : result.status >= 500 || result.status === 0 ? 502
        : result.status;
    return json({ error: result.message, githubStatus: result.status }, status);
  }
  return json(
    {
      name: result.name,
      htmlUrl: result.htmlUrl,
      cloneUrl: result.cloneUrl,
      defaultBranch: result.defaultBranch,
    },
    201,
  );
}

// ── Forward to ManagerDO ─────────────────────────────────────────────

async function forwardToManager(
  env: Env,
  projectId: string,
  doPath: string,
  request: Request,
): Promise<Response> {
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

// ── Dispatch Claude Code ─────────────────────────────────────────────

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
    `SELECT id, repo_full_name AS repoFullName, clone_url AS cloneUrl
     FROM projects WHERE id = ?`,
  )
    .bind(projectId)
    .first<{ id: string; repoFullName: string; cloneUrl: string }>();
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
        repoName: deriveRepoNameFromFullName(project.repoFullName),
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

  let diff: { summary?: string; diffStat?: string; diff?: string; diffTruncated?: boolean } | null = null;
  let failure: { error?: string; stage?: string } | null = null;
  if (row.diffSummaryRaw) {
    try {
      const parsed = JSON.parse(row.diffSummaryRaw) as Record<string, unknown>;
      if (row.status === "failed") {
        failure = parsed as { error?: string; stage?: string };
      } else {
        diff = parsed as { summary?: string; diffStat?: string; diff?: string; diffTruncated?: boolean };
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

async function handleJobStream(env: Env, jobId: string): Promise<Response> {
  const stub = env.AGENT_HUB_DO.get(env.AGENT_HUB_DO.idFromName("singleton"));
  return stub.fetch(
    new Request(`http://do/subscribe/${encodeURIComponent(jobId)}`, { method: "GET" }),
  );
}

// ── Dropnotes ────────────────────────────────────────────────────────

async function handleCreateDropnote(env: Env, request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { content?: string } | null;
  if (typeof body?.content !== "string" || !body.content.trim()) {
    return json({ error: "missing 'content'" }, 400);
  }
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO dropnotes (id, content) VALUES (?, ?)")
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

// ── Diagnostics ──────────────────────────────────────────────────────

/**
 * GET /api/_diag/github-token — classify the configured GITHUB_TOKEN.
 *
 * Calls `GET https://api.github.com/user` with the token and inspects the
 * response headers:
 *   - x-oauth-scopes present                → classic PAT; lists scopes
 *   - github-authentication-token-expiration → fine-grained token; lists exp
 *
 * Returns `{ ok, status, tokenClass, scopes?, expiresAt?, login, rateLimit }`.
 * No secret material in the response.
 */
async function handleDiagGithubToken(env: Env): Promise<Response> {
  if (!env.GITHUB_TOKEN) {
    return json({ ok: false, error: "GITHUB_TOKEN not configured on server" }, 500);
  }
  let resp: Response;
  try {
    resp = await fetch("https://api.github.com/user", {
      headers: {
        "Authorization": `token ${env.GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "the-ceo-worker",
      },
    });
  } catch (err) {
    return json(
      { ok: false, error: `Network error reaching GitHub: ${(err as Error).message}` },
      502,
    );
  }

  const scopesHeader = resp.headers.get("x-oauth-scopes");
  const expiresHeader = resp.headers.get("github-authentication-token-expiration");
  const rateLimit = {
    limit: resp.headers.get("x-ratelimit-limit"),
    remaining: resp.headers.get("x-ratelimit-remaining"),
    reset: resp.headers.get("x-ratelimit-reset"),
  };

  let tokenClass: "classic" | "fine-grained" | "unknown";
  if (scopesHeader !== null) tokenClass = "classic";
  else if (expiresHeader !== null) tokenClass = "fine-grained";
  else tokenClass = "unknown";

  let login: string | null = null;
  if (resp.ok) {
    try {
      const body = (await resp.json()) as { login?: string };
      login = body.login ?? null;
    } catch {
      // ignore
    }
  }

  return json({
    ok: resp.ok,
    status: resp.status,
    tokenClass,
    scopes: scopesHeader
      ? scopesHeader.split(",").map((s) => s.trim()).filter(Boolean)
      : null,
    expiresAt: expiresHeader,
    login,
    rateLimit,
  });
}

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

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Derive a local directory name for the agent's checkout from a GitHub
 * full_name (owner/repo) — strip the owner.
 */
function deriveRepoNameFromFullName(fullName: string): string {
  const slash = fullName.lastIndexOf("/");
  return slash >= 0 ? fullName.slice(slash + 1) : fullName;
}

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
