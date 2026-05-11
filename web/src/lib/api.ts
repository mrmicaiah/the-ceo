// Thin API client for The CEO's Worker. Same-origin in both dev (via Vite
// proxy) and prod (the Worker serves both static assets and /api/*).
//
// Streaming endpoints emit SSE in the format the Worker's chat primitive
// produces:
//   event: text   data: {"delta": "..."}
//   event: done   data: {}
//   event: error  data: {"message": "..."}
// We expose callback-based consumers (onChunk / onDone / onError) so callers
// don't need to know about streams or SSE framing.

import type {
  Briefing,
  CastResult,
  ChatWithMessages,
  EmployeeId,
  ProjectListItem,
  WrapResult,
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

/** PATCH /api/projects/:id — partial update of name and/or repoPath. */
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

/** POST /api/projects/:id/briefing-update — single-field briefing edit. */
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

/** POST /api/github/create-repo — creates a repo via the configured token. */
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

export async function wrapChat(chatId: string): Promise<WrapResult> {
  const resp = await fetch(`/api/chats/${encodeURIComponent(chatId)}/wrap`, {
    method: "POST",
    headers: headers(),
  });
  return jsonOrThrow<WrapResult>(resp);
}

// ── Cast ────────────────────────────────────────────────────────────

export async function castEmployee(input: {
  projectId: string;
  employee: EmployeeId;
  task: string;
  sourceChatId?: string;
}): Promise<CastResult> {
  const resp = await fetch(
    `/api/projects/${encodeURIComponent(input.projectId)}/cast`,
    {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        employee: input.employee,
        task: input.task,
        sourceChatId: input.sourceChatId,
      }),
    },
  );
  return jsonOrThrow<CastResult>(resp);
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

/** POST to the CEO chat endpoint, stream the assistant's reply. */
export async function sendCeoMessage(
  input: { chatId: string; message: string },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<StreamResult> {
  return streamChat("/api/ceo/chat", input, handlers, signal);
}

/** POST to an employee chat endpoint with optional project casting. */
export async function sendEmployeeMessage(
  input: {
    employee: EmployeeId;
    chatId: string;
    message: string;
    projectId?: string;
  },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<StreamResult> {
  return streamChat(
    `/api/employees/${input.employee}/chat`,
    { chatId: input.chatId, message: input.message, projectId: input.projectId },
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
  data: { delta?: string; message?: string } | null;
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
