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
