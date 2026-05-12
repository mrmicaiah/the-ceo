// Thin API client for The CEO's Worker. v2 surface.
//
// Streaming endpoints emit SSE in the format the Worker's chat primitive
// produces:
//   event: text   data: {"delta": "..."}
//   event: done   data: {}
//   event: error  data: {"message": "..."}
// Consumers expose callback-based handlers (onChunk / onDone / onError) so
// callers don't need to know about streams or SSE framing.

import type {
  Briefing,
  ChatWithMessages,
  DispatchResult,
  Dropnote,
  ExecutionJobSnapshot,
  ManagerChatResolve,
  ProjectListItem,
  StreamCompletedEvent,
  StreamFailedEvent,
  StreamOutputEvent,
} from "../types";

const AUTH_TOKEN = (import.meta.env.VITE_AUTH_TOKEN as string | undefined) ?? "";

function headers(extra: Record<string, string> = {}): HeadersInit {
  const h: Record<string, string> = { ...extra };
  if (AUTH_TOKEN) h.Authorization = `Bearer ${AUTH_TOKEN}`;
  return h;
}

async function jsonOrThrow<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new ApiError(resp.status, text || resp.statusText);
  }
  return (await resp.json()) as T;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(`API ${status}: ${message}`);
    this.name = "ApiError";
  }
}

// ── Projects ─────────────────────────────────────────────────────────

export async function listProjects(): Promise<ProjectListItem[]> {
  const resp = await fetch("/api/projects", { headers: headers() });
  return jsonOrThrow<ProjectListItem[]>(resp);
}

export async function getProject(projectId: string): Promise<ProjectListItem> {
  const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    headers: headers(),
  });
  return jsonOrThrow<ProjectListItem>(resp);
}

export async function createProject(input: {
  name: string;
  repoPath?: string;
  initialGoal?: string;
}): Promise<ProjectListItem> {
  const resp = await fetch("/api/projects", {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  return jsonOrThrow<ProjectListItem>(resp);
}

export async function patchProject(
  projectId: string,
  patch: { name?: string; repoPath?: string | null },
): Promise<ProjectListItem> {
  const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  return jsonOrThrow<ProjectListItem>(resp);
}

export async function updateBriefingField(
  projectId: string,
  field: "goal" | "state" | "nextMove" | "why",
  value: string,
): Promise<Briefing> {
  const resp = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/briefing-update`,
    {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ field, value }),
    },
  );
  return jsonOrThrow<Briefing>(resp);
}

export interface CreatedRepo {
  name: string;
  htmlUrl: string;
  cloneUrl: string;
  projectId?: string;
}
export async function createGithubRepo(input: {
  name: string;
  description?: string;
  isPrivate?: boolean;
  projectId?: string;
}): Promise<CreatedRepo> {
  const resp = await fetch("/api/github/create-repo", {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      private: input.isPrivate ?? true,
      projectId: input.projectId,
    }),
  });
  return jsonOrThrow<CreatedRepo>(resp);
}

// ── Manager chat ────────────────────────────────────────────────────

/**
 * Resolve (or create) the canonical manager chat for this project.
 * Idempotent: repeated calls return the same chatId. Called on workspace
 * open so the chat history can be loaded before the user sends anything.
 */
export async function resolveManagerChat(projectId: string): Promise<ManagerChatResolve> {
  const resp = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/manager-chat`,
    { headers: headers() },
  );
  return jsonOrThrow<ManagerChatResolve>(resp);
}

// ── Claude Code dispatch ─────────────────────────────────────────────

export async function dispatchClaudeCode(input: {
  projectId: string;
  chatId: string;
  summary: string;
  prompt: string;
}): Promise<DispatchResult> {
  const resp = await fetch(
    `/api/projects/${encodeURIComponent(input.projectId)}/dispatch-claude-code`,
    {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        chatId: input.chatId,
        summary: input.summary,
        prompt: input.prompt,
      }),
    },
  );
  return jsonOrThrow<DispatchResult>(resp);
}

export async function getJob(jobId: string): Promise<ExecutionJobSnapshot | null> {
  const resp = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    headers: headers(),
  });
  if (resp.status === 404) return null;
  return jsonOrThrow<ExecutionJobSnapshot>(resp);
}

export interface JobStreamHandlers {
  onOutput: (event: StreamOutputEvent) => void;
  onCompleted: (event: StreamCompletedEvent) => void;
  onFailed: (event: StreamFailedEvent) => void;
  onError?: (message: string) => void;
  onSubscribed?: () => void;
  onClose?: () => void;
}

export function openJobStream(jobId: string, h: JobStreamHandlers): () => void {
  const ctrl = new AbortController();
  (async () => {
    try {
      const resp = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/stream`, {
        headers: headers(),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        h.onError?.(`stream open failed: ${resp.status}`);
        return;
      }
      const reader = resp.body?.getReader();
      if (!reader) {
        h.onError?.("no stream body");
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const ev = parseSseEvent(raw);
          if (!ev) continue;
          if (ev.type === "subscribed") {
            h.onSubscribed?.();
          } else if (ev.type === "output") {
            h.onOutput(ev.data as StreamOutputEvent);
          } else if (ev.type === "completed") {
            h.onCompleted(ev.data as StreamCompletedEvent);
          } else if (ev.type === "failed") {
            h.onFailed(ev.data as StreamFailedEvent);
          }
        }
      }
      h.onClose?.();
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        h.onError?.((err as Error).message);
      }
    }
  })();
  return () => ctrl.abort();
}

// ── Briefing ─────────────────────────────────────────────────────────

export async function getBriefing(projectId: string): Promise<Briefing> {
  const resp = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/briefing`,
    { headers: headers() },
  );
  return jsonOrThrow<Briefing>(resp);
}

// ── Chats ───────────────────────────────────────────────────────────

export async function getChat(chatId: string): Promise<ChatWithMessages | null> {
  const resp = await fetch(`/api/chats/${encodeURIComponent(chatId)}`, {
    headers: headers(),
  });
  if (resp.status === 404) return null;
  return jsonOrThrow<ChatWithMessages>(resp);
}

// ── Dropnotes ───────────────────────────────────────────────────────

export async function createDropnote(content: string): Promise<Dropnote> {
  const resp = await fetch("/api/dropnotes", {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ content }),
  });
  return jsonOrThrow<Dropnote>(resp);
}

export async function listDropnotes(): Promise<Dropnote[]> {
  const resp = await fetch("/api/dropnotes", { headers: headers() });
  return jsonOrThrow<Dropnote[]>(resp);
}

// ── Streaming chat ──────────────────────────────────────────────────

export interface StreamHandlers {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export interface StreamResult {
  chatId: string;
}

/** POST to the manager chat endpoint for a project, stream the reply. */
export async function sendManagerMessage(
  input: { projectId: string; chatId: string; message: string },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<StreamResult> {
  return streamChat(
    `/api/projects/${encodeURIComponent(input.projectId)}/manager/chat`,
    { chatId: input.chatId, message: input.message },
    handlers,
    signal,
  );
}

async function streamChat(
  url: string,
  body: object,
  { onChunk, onDone, onError }: StreamHandlers,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const resp = await fetch(url, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    onError(`Server error ${resp.status}: ${text}`);
    onDone();
    return { chatId: "" };
  }

  const chatId = resp.headers.get("X-Chat-Id") ?? "";
  const reader = resp.body?.getReader();
  if (!reader) {
    onError("Empty response body");
    onDone();
    return { chatId };
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev = parseSseEvent(raw);
        if (!ev) continue;
        if (ev.type === "text" && typeof ev.data?.delta === "string") {
          onChunk(ev.data.delta);
        } else if (ev.type === "done") {
          onDone();
          return { chatId };
        } else if (ev.type === "error") {
          onError(typeof ev.data?.message === "string" ? ev.data.message : "stream error");
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      onError((err as Error).message);
    }
  }

  onDone();
  return { chatId };
}

interface ParsedSseEvent {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

function parseSseEvent(raw: string): ParsedSseEvent | null {
  let type = "";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!type) return null;
  const dataStr = dataLines.join("");
  if (!dataStr) return { type, data: null };
  try {
    return { type, data: JSON.parse(dataStr) };
  } catch {
    return { type, data: null };
  }
}
