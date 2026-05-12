// ManagerDO — one DO per project, addressed by projectId (v3).
//
// Each project's manager is bound to its repo. The system prompt assembly
// reads .ceo/*.md from the repo (via GitHub API) on each chat turn —
// briefings table is gone. The directory IS the manager's memory.
//
// Caching: GitHub round-trips are slow; we cache the four .ceo/* file
// contents in DO storage with a 60s TTL. Run #11 will invalidate the cache
// on writes; for now the cache simply expires.

import { Env } from "../types";
import { handleChatTurn, getStateWaitUntil } from "../lib/chat";
import { MANAGER_SYSTEM_PROMPT } from "../lib/manager";
import { getRepoFile } from "../lib/github";

const RECENT_UNSEEN_JOB_LIMIT = 10;
const CEO_CACHE_KEY = "ceo-files-v1";
const CEO_CACHE_TTL_MS = 60_000;

interface CeoFiles {
  goal: string | null;
  context: string | null;
  decisions: string | null;
  board: string | null;
  fetchedAt: number;
  /** True if every fetch returned 404 — likely the .ceo/ dir is missing. */
  directoryMissing: boolean;
}

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
   * Resolve (or create) the canonical manager chat for this project.
   * Idempotent — repeated calls return the same chatId.
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
    await this.env.DB.prepare("INSERT INTO chats (id, project_id) VALUES (?, ?)")
      .bind(chatId, projectId)
      .run();
    return json({ chatId, projectId, created: true });
  }

  /**
   * Handle a chat turn for this project's manager. Body shape:
   *   { chatId?, message }
   * If chatId is omitted, the canonical manager chat is resolved (or created).
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
    await this.env.DB.prepare("INSERT INTO chats (id, project_id) VALUES (?, ?)")
      .bind(chatId, projectId)
      .run();
    return chatId;
  }

  /**
   * Compose the manager's system prompt. Layout (v3):
   *   MANAGER_SYSTEM_PROMPT
   * + ## Current project: <repo_full_name>
   * +   Current project ID + Repo url
   * +   ### Goal     (from .ceo/goal.md, or "(not yet set)")
   * +   ### Context  (from .ceo/context.md, or "(not yet captured)")
   * +   ### Recent decisions (from .ceo/decisions.md, or "(none recorded)")
   * +   ### Board    (from .ceo/board.md, or "(not yet posted)")
   * + recent unseen Claude Code job results (marked seen as a side effect)
   *
   * If every .ceo/ file 404s, we add a top-level warning before the four
   * sections noting that the directory may be missing. The manager works
   * without memory if it has to — we don't fail the turn.
   */
  private async buildSystemPrompt(projectId: string): Promise<string> {
    const project = await this.env.DB.prepare(
      `SELECT id,
              repo_full_name AS repoFullName,
              clone_url AS cloneUrl
       FROM projects WHERE id = ?`,
    )
      .bind(projectId)
      .first<{ id: string; repoFullName: string; cloneUrl: string }>();

    if (!project) {
      // Project doesn't exist (shouldn't happen via normal flow — the route
      // handler verifies, but defensive). Return the bare prompt so the
      // manager can still respond, even if without context.
      return MANAGER_SYSTEM_PROMPT;
    }

    const ceo = await this.loadCeoFiles(project.repoFullName);

    const lines: string[] = ["", ""];
    lines.push(`## Current project: ${project.repoFullName}`);
    lines.push("");
    lines.push(`Current project ID: ${projectId}`);
    lines.push(`Repo: ${project.cloneUrl}`);

    if (ceo.directoryMissing) {
      lines.push("");
      lines.push(
        "Warning: .ceo/ directory may be missing from this repo. The manager is operating without committed memory until this is restored.",
      );
    }

    lines.push("");
    lines.push("### Goal");
    lines.push(formatCeoSection(ceo.goal, "(not yet set)"));

    lines.push("");
    lines.push("### Context");
    lines.push(formatCeoSection(ceo.context, "(not yet captured)"));

    lines.push("");
    lines.push("### Recent decisions");
    lines.push(formatCeoSection(ceo.decisions, "(none recorded)"));

    lines.push("");
    lines.push("### Board");
    lines.push(formatCeoSection(ceo.board, "(not yet posted)"));

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
   * Read the four .ceo/ files for this repo, with a 60s DO-storage cache.
   * We fetch them in parallel via getRepoFile (which uses the repo's default
   * branch when no ref is passed — that sidesteps storing default_branch on
   * the project row).
   *
   * Missing files (404 from GitHub) are surfaced as null in the cached
   * record; the rendering layer turns them into per-file placeholders. If
   * all four are null, the rendering adds a top-level directory-missing
   * warning.
   *
   * Errors that aren't 404 (e.g., 500 from GitHub, rate limit) propagate
   * as null reads with a degraded prompt; we explicitly don't throw —
   * better to give the manager a memory-less turn than to crash the chat.
   */
  private async loadCeoFiles(repoFullName: string): Promise<CeoFiles> {
    const cached = await this.state.storage.get<CeoFiles>(CEO_CACHE_KEY);
    if (cached && Date.now() - cached.fetchedAt < CEO_CACHE_TTL_MS) {
      return cached;
    }

    if (!this.env.GITHUB_TOKEN) {
      // No GitHub token — degrade gracefully.
      const empty: CeoFiles = {
        goal: null,
        context: null,
        decisions: null,
        board: null,
        fetchedAt: Date.now(),
        directoryMissing: true,
      };
      await this.state.storage.put(CEO_CACHE_KEY, empty);
      return empty;
    }

    const token = this.env.GITHUB_TOKEN;
    const [goal, context, decisions, board] = await Promise.all([
      safeGetFile(token, repoFullName, ".ceo/goal.md"),
      safeGetFile(token, repoFullName, ".ceo/context.md"),
      safeGetFile(token, repoFullName, ".ceo/decisions.md"),
      safeGetFile(token, repoFullName, ".ceo/board.md"),
    ]);

    const fresh: CeoFiles = {
      goal,
      context,
      decisions,
      board,
      fetchedAt: Date.now(),
      directoryMissing: goal === null && context === null && decisions === null && board === null,
    };
    await this.state.storage.put(CEO_CACHE_KEY, fresh);
    return fresh;
  }

  /**
   * Dex-style helper preserved from run #9 with the v2 rename. Return any
   * execution_jobs in terminal status that the manager hasn't reviewed
   * (manager_seen_at IS NULL); mark them seen as a side effect.
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
      `SELECT id AS jobId, summary, status, diff_summary AS diffSummaryRaw
       FROM execution_jobs
       WHERE project_id = ?
         AND status IN ('completed', 'failed')
         AND manager_seen_at IS NULL
       ORDER BY created_at ASC
       LIMIT ?`,
    )
      .bind(projectId, RECENT_UNSEEN_JOB_LIMIT)
      .all<{ jobId: string; summary: string; status: string; diffSummaryRaw: string | null }>();

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

/** Render a .ceo/ file's content into the prompt, or its placeholder. */
function formatCeoSection(content: string | null, placeholder: string): string {
  if (!content) return placeholder;
  const trimmed = content.trim();
  return trimmed.length === 0 ? placeholder : trimmed;
}

/** Read a .ceo/ file; turn any error (404 or otherwise) into null. */
async function safeGetFile(
  token: string,
  fullName: string,
  path: string,
): Promise<string | null> {
  try {
    const file = await getRepoFile(token, fullName, path);
    return file ? file.content : null;
  } catch (err) {
    console.error(
      `[manager] failed to fetch ${fullName}/${path}: ${(err as Error).message}`,
    );
    return null;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
