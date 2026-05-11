// AgentHub — singleton Durable Object that owns the local agent's websocket
// connection and routes work both directions.
//
// Responsibilities:
//   - Accept a single agent's websocket via /connect (Worker upstream has
//     already validated the Bearer AGENT_TOKEN before forwarding the upgrade).
//   - Dispatch jobs over the live socket via /dispatch (called by the Worker
//     when a user clicks "Run Claude Code →").
//   - Fan output events from the agent out to SSE listeners via /subscribe/:jobId
//     so the frontend can stream live progress without polling.
//   - Persist terminal events (completed/failed) to execution_jobs in D1.
//   - On agent reconnect, flush any jobs that are still status='queued'.
//
// WebSocket hibernation note: we use the hibernation API (acceptWebSocket).
// The connection survives DO eviction; SSE subscriber state does not. If the
// DO is evicted mid-job, in-flight live streams break — the frontend falls
// back to polling /api/jobs/:id for the snapshot on next view.

import { Env } from "../types";

const SUBSCRIBERS: Map<string, Map<string, ReadableStreamDefaultController<Uint8Array>>> = new Map();
const OUTPUT_BUFFERS: Map<string, string> = new Map();

// ── Wire shapes ───────────────────────────────────────────────────────────

type WorkerToAgent =
  | {
      type: "job";
      jobId: string;
      repoName: string;
      cloneUrl: string | null;
      prompt: string;
      projectId: string;
      chatId: string;
    }
  | { type: "ping" };

type AgentToWorker =
  | { type: "ready"; agentVersion: string }
  | { type: "heartbeat" }
  | {
      type: "output";
      jobId: string;
      kind: "text" | "tool_use" | "tool_result";
      payload: string;
    }
  | {
      type: "completed";
      jobId: string;
      diffStat: string;
      diff: string;
      diffTruncated: boolean;
      summary: string;
    }
  | {
      type: "failed";
      jobId: string;
      error: string;
      stage: "workspace" | "execution" | "diff";
    };

interface DispatchPayload {
  jobId: string;
  repoName: string;
  cloneUrl: string | null;
  prompt: string;
  projectId: string;
  chatId: string;
}

// ── DO ────────────────────────────────────────────────────────────────────

export class AgentHubDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/connect") {
      return this.handleConnect(request);
    }
    if (path === "/dispatch" && request.method === "POST") {
      return this.handleDispatch(request);
    }
    if (path.startsWith("/subscribe/") && request.method === "GET") {
      const jobId = decodeURIComponent(path.slice("/subscribe/".length));
      return this.handleSubscribe(jobId);
    }
    if (path === "/status" && request.method === "GET") {
      return this.handleStatus();
    }
    return new Response("not found", { status: 404 });
  }

  // ── Agent connection lifecycle ──────────────────────────────────────────

  private async handleConnect(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }

    // Drop any older socket — newer connection wins.
    for (const existing of this.state.getWebSockets()) {
      try {
        existing.close(1000, "replaced by newer connection");
      } catch {
        // ignore
      }
    }

    const pair = new WebSocketPair();
    const server = pair[1];
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let msg: AgentToWorker;
    try {
      msg = JSON.parse(message) as AgentToWorker;
    } catch {
      return;
    }
    switch (msg.type) {
      case "ready":
        await this.onReady();
        return;
      case "heartbeat":
        return;
      case "output":
        this.onOutput(msg);
        return;
      case "completed":
        await this.onCompleted(msg);
        return;
      case "failed":
        await this.onFailed(msg);
        return;
    }
  }

  async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // Nothing to do — the next agent connect replaces this socket. Jobs in
    // flight will time out from the frontend's perspective; they remain in
    // status='running' in D1 until a new agent sends an explicit
    // completed/failed (which won't happen for orphaned jobs). v0 caveat.
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────

  private async handleDispatch(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as DispatchPayload | null;
    if (!body?.jobId) {
      return jsonResponse({ error: "missing jobId" }, 400);
    }

    const sockets = this.state.getWebSockets();
    if (sockets.length === 0) {
      // No agent connected. Worker has already inserted the job with
      // status='queued'; nothing more to do here.
      return jsonResponse({ status: "queued" });
    }

    const out: WorkerToAgent = {
      type: "job",
      jobId: body.jobId,
      repoName: body.repoName,
      cloneUrl: body.cloneUrl,
      prompt: body.prompt,
      projectId: body.projectId,
      chatId: body.chatId,
    };
    try {
      sockets[0].send(JSON.stringify(out));
    } catch (err) {
      return jsonResponse({ error: `send failed: ${(err as Error).message}` }, 502);
    }

    await this.env.DB.prepare(
      "UPDATE execution_jobs SET status = 'running' WHERE id = ? AND status = 'queued'",
    )
      .bind(body.jobId)
      .run();

    return jsonResponse({ status: "dispatched" });
  }

  // ── Subscribe (SSE) ──────────────────────────────────────────────────────

  private handleSubscribe(jobId: string): Response {
    const subscriberId = crypto.randomUUID();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let perJob = SUBSCRIBERS.get(jobId);
        if (!perJob) {
          perJob = new Map();
          SUBSCRIBERS.set(jobId, perJob);
        }
        perJob.set(subscriberId, controller);
        controller.enqueue(encoder.encode("event: subscribed\ndata: {}\n\n"));
      },
      cancel: () => {
        const perJob = SUBSCRIBERS.get(jobId);
        if (perJob) {
          perJob.delete(subscriberId);
          if (perJob.size === 0) SUBSCRIBERS.delete(jobId);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // ── Agent message handlers ──────────────────────────────────────────────

  private async onReady(): Promise<void> {
    const { results: queued } = await this.env.DB.prepare(
      `SELECT j.id AS jobId,
              j.project_id AS projectId,
              j.chat_id AS chatId,
              j.prompt,
              p.name AS projectName,
              p.clone_url AS cloneUrl
       FROM execution_jobs j
       JOIN projects p ON p.id = j.project_id
       WHERE j.status = 'queued'
       ORDER BY j.created_at ASC`,
    ).all<{
      jobId: string;
      projectId: string;
      chatId: string;
      prompt: string;
      projectName: string;
      cloneUrl: string | null;
    }>();

    if (queued.length === 0) return;
    const sockets = this.state.getWebSockets();
    if (sockets.length === 0) return;

    for (const job of queued) {
      const out: WorkerToAgent = {
        type: "job",
        jobId: job.jobId,
        repoName: deriveRepoName(job.cloneUrl, job.projectName),
        cloneUrl: job.cloneUrl,
        prompt: job.prompt,
        projectId: job.projectId,
        chatId: job.chatId,
      };
      try {
        sockets[0].send(JSON.stringify(out));
        await this.env.DB.prepare(
          "UPDATE execution_jobs SET status = 'running' WHERE id = ?",
        )
          .bind(job.jobId)
          .run();
      } catch {
        // If send fails, the job stays queued and the next ready replays.
      }
    }
  }

  private onOutput(msg: AgentToWorker & { type: "output" }): void {
    // Accumulate text only (tool_use / tool_result are metadata; frontend keeps
    // them as ephemeral annotations during the run).
    if (msg.kind === "text") {
      const existing = OUTPUT_BUFFERS.get(msg.jobId) ?? "";
      OUTPUT_BUFFERS.set(msg.jobId, existing + msg.payload);
    }
    this.fanOut(msg.jobId, "output", {
      kind: msg.kind,
      payload: msg.payload,
    });
  }

  private async onCompleted(msg: AgentToWorker & { type: "completed" }): Promise<void> {
    const accumulatedOutput = OUTPUT_BUFFERS.get(msg.jobId) ?? "";
    OUTPUT_BUFFERS.delete(msg.jobId);

    const diffSummary = JSON.stringify({
      summary: msg.summary,
      diffStat: msg.diffStat,
      diff: msg.diff,
      diffTruncated: msg.diffTruncated,
    });

    await this.env.DB.prepare(
      `UPDATE execution_jobs
       SET status = 'completed',
           output_stream = ?,
           diff_summary = ?,
           completed_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(accumulatedOutput, diffSummary, msg.jobId)
      .run();

    this.fanOut(msg.jobId, "completed", {
      summary: msg.summary,
      diffStat: msg.diffStat,
      diff: msg.diff,
      diffTruncated: msg.diffTruncated,
    });
    this.closeFanOut(msg.jobId);
  }

  private async onFailed(msg: AgentToWorker & { type: "failed" }): Promise<void> {
    OUTPUT_BUFFERS.delete(msg.jobId);

    const diffSummary = JSON.stringify({
      error: msg.error,
      stage: msg.stage,
    });

    await this.env.DB.prepare(
      `UPDATE execution_jobs
       SET status = 'failed',
           diff_summary = ?,
           completed_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(diffSummary, msg.jobId)
      .run();

    this.fanOut(msg.jobId, "failed", { error: msg.error, stage: msg.stage });
    this.closeFanOut(msg.jobId);
  }

  // ── Fan-out helpers ─────────────────────────────────────────────────────

  private fanOut(jobId: string, event: string, data: unknown): void {
    const perJob = SUBSCRIBERS.get(jobId);
    if (!perJob || perJob.size === 0) return;
    const encoder = new TextEncoder();
    const sse = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const dead: string[] = [];
    for (const [id, controller] of perJob) {
      try {
        controller.enqueue(sse);
      } catch {
        dead.push(id);
      }
    }
    for (const id of dead) perJob.delete(id);
  }

  private closeFanOut(jobId: string): void {
    const perJob = SUBSCRIBERS.get(jobId);
    if (!perJob) return;
    for (const controller of perJob.values()) {
      try {
        controller.close();
      } catch {
        // ignore
      }
    }
    SUBSCRIBERS.delete(jobId);
  }

  // ── Status (debug) ──────────────────────────────────────────────────────

  private handleStatus(): Response {
    return jsonResponse({
      agentConnected: this.state.getWebSockets().length > 0,
      activeBuffers: OUTPUT_BUFFERS.size,
      subscribedJobs: SUBSCRIBERS.size,
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Derive the directory name for the local checkout from the clone URL.
 * Falls back to a slug of the project name if no clone URL is present.
 */
function deriveRepoName(cloneUrl: string | null, projectName: string): string {
  if (cloneUrl) {
    const m = cloneUrl.match(/\/([^/]+?)(?:\.git)?$/);
    if (m?.[1]) return m[1];
  }
  return projectName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
