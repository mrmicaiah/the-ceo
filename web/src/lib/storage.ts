// localStorage helpers. v0 just needs the CEO chat id to persist across
// page reloads so the conversation continues where the user left off.

const KEY = "theceo.ceoChatId";

export function getOrCreateCeoChatId(): string {
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Fall back to an in-memory id if storage is unavailable.
    return crypto.randomUUID();
  }
}

// ── Claude Code dispatch jobIds ──────────────────────────────────────
//
// When Dex emits a ```dispatch_claude_code block and the user clicks
// "Run Claude Code →", we POST and get back a jobId. We persist the
// (chatId, action-content) → jobId mapping in localStorage so that on
// page reload the affordance morphs straight into the panel for the
// existing job rather than offering to dispatch a new one. Per-browser
// only; that's fine for v0 single-user.

function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function dispatchKey(chatId: string, summary: string, prompt: string): string {
  return `theceo.dispatch.${chatId}.${shortHash(summary)}.${shortHash(prompt)}`;
}

export function rememberDispatchedJobId(
  chatId: string,
  summary: string,
  prompt: string,
  jobId: string,
): void {
  try {
    window.localStorage.setItem(dispatchKey(chatId, summary, prompt), jobId);
  } catch {
    // ignore
  }
}

export function getDispatchedJobId(
  chatId: string,
  summary: string,
  prompt: string,
): string | null {
  try {
    return window.localStorage.getItem(dispatchKey(chatId, summary, prompt));
  } catch {
    return null;
  }
}
