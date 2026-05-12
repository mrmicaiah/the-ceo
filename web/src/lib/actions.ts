// Parser for fenced action blocks the manager emits.
//
// v3 (run #10): the manager has one action available — `dispatch_claude_code`.
// The other v1/v2 action types (cast, handoff, create_project, rename_project,
// update_briefing, create_repo) are gone:
//   - cast / handoff: retired in run #9
//   - create_project: now a UI flow (NewProjectModal); the manager doesn't
//     emit project-creation actions
//   - update_briefing: briefings table retired in run #10
//   - rename_project: project name = repo_full_name; no rename to do
//   - create_repo: folded into /api/projects/new
//
// Returns null on any malformed input. Callers fall back to rendering the
// original text as a regular code block.

export type ParsedAction = {
  type: "dispatch_claude_code";
  project: string;
  summary: string;
  prompt: string;
};

export const ACTION_LANGS: ReadonlySet<string> = new Set([
  "dispatch_claude_code",
]);

export function parseActionBlock(
  language: string,
  content: string,
): ParsedAction | null {
  const fields = parseFields(content);
  switch (language) {
    case "dispatch_claude_code":
      return parseDispatchClaudeCode(fields);
    default:
      return null;
  }
}

/** A stable id derived from an action's content — used to dedup auto-fires. */
export function actionId(action: ParsedAction): string {
  return `dispatch_claude_code:${action.project}:${action.summary}`;
}

// ── Internals ──────────────────────────────────────────────────────────

/**
 * Parse the fenced-block body into a flat dictionary of fields.
 *
 * Handles two forms per line:
 *   - `key: value`              — single-line value, trimmed
 *   - `key: |` then indented block — multi-line value (YAML pipe), strips
 *     the common leading indent from each line in the block.
 *
 * The multi-line block terminates at the next unindented top-level key or
 * end-of-input.
 */
function parseFields(content: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const m = line.match(/^([a-zA-Z_]+)\s*:\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1].toLowerCase();
    const rawValue = m[2];

    if (rawValue.trim() === "|") {
      i++;
      const collected: string[] = [];
      let baseIndent: number | null = null;
      while (i < lines.length) {
        const next = lines[i];
        if (next.length > 0 && !/^\s/.test(next) && /^[a-zA-Z_]+\s*:/.test(next)) {
          break;
        }
        if (next.trim() === "") {
          collected.push("");
          i++;
          continue;
        }
        if (baseIndent === null) {
          const im = next.match(/^(\s*)/);
          baseIndent = im ? im[1].length : 0;
        }
        const im = next.match(/^(\s*)/);
        const indent = im ? im[1].length : 0;
        collected.push(next.slice(Math.min(indent, baseIndent ?? 0)));
        i++;
      }
      while (collected.length > 0 && collected[0].trim() === "") collected.shift();
      while (collected.length > 0 && collected[collected.length - 1].trim() === "") collected.pop();
      if (collected.length > 0) fields[key] = collected.join("\n");
    } else {
      const value = rawValue.trim();
      if (value.length > 0) fields[key] = value;
      i++;
    }
  }
  return fields;
}

function parseDispatchClaudeCode(f: Record<string, string>): ParsedAction | null {
  if (!f.project || !f.summary || !f.prompt) return null;
  return {
    type: "dispatch_claude_code",
    project: f.project,
    summary: f.summary,
    prompt: f.prompt,
  };
}
