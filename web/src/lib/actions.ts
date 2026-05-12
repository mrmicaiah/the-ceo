// Unified parser for every fenced action block the CEO and Dex emit.
//
// Action languages and their shapes:
//   - cast            (CEO)
//   - create_project  (CEO)
//   - rename_project  (CEO)
//   - update_briefing (CEO)
//   - create_repo     (CEO)
//   - dispatch_claude_code (Dex)  — uses YAML pipe syntax for multi-line prompt
//   - handoff         (any named employee) — uses YAML pipe for multi-line brief.
//                     'from' is derived from rendering context, not the block.
//
// Returns null on any malformed input. Callers fall back to rendering the
// original text as a regular code block.

import type { EmployeeId } from "../types";

export type BriefingField = "goal" | "state" | "nextMove" | "why";

export type ParsedAction =
  | {
      type: "cast";
      employee: EmployeeId;
      project: string;
      task: string;
      reason: string;
    }
  | {
      type: "create_project";
      name: string;
      initialGoal: string;
      reason: string;
    }
  | {
      type: "rename_project";
      project: string;
      newName: string;
    }
  | {
      type: "update_briefing";
      project: string;
      field: BriefingField;
      value: string;
    }
  | {
      type: "create_repo";
      project: string | undefined;
      name: string;
      description: string;
      isPrivate: boolean;
    }
  | {
      type: "dispatch_claude_code";
      project: string;
      summary: string;
      prompt: string;
    }
  | {
      type: "handoff";
      toEmployee: EmployeeId;
      project: string;
      brief: string;
      // 'from' is supplied by the renderer (which knows the current chat's
      // employeeId). It's deliberately not in the block — the source is
      // ambiguous-by-message-position by design.
    };

export const ACTION_LANGS: ReadonlySet<string> = new Set([
  "cast",
  "create_project",
  "rename_project",
  "update_briefing",
  "create_repo",
  "dispatch_claude_code",
  "handoff",
]);

export function parseActionBlock(
  language: string,
  content: string,
): ParsedAction | null {
  const fields = parseFields(content);
  switch (language) {
    case "cast":
      return parseCast(fields);
    case "create_project":
      return parseCreateProject(fields);
    case "rename_project":
      return parseRenameProject(fields);
    case "update_briefing":
      return parseUpdateBriefing(fields);
    case "create_repo":
      return parseCreateRepo(fields);
    case "dispatch_claude_code":
      return parseDispatchClaudeCode(fields);
    case "handoff":
      return parseHandoff(fields);
    default:
      return null;
  }
}

/** A stable id derived from an action's content — used to dedup auto-fires. */
export function actionId(action: ParsedAction): string {
  switch (action.type) {
    case "cast":
      return `cast:${action.project}:${action.employee}:${action.task}`;
    case "create_project":
      return `create_project:${action.name}`;
    case "rename_project":
      return `rename_project:${action.project}:${action.newName}`;
    case "update_briefing":
      return `update_briefing:${action.project}:${action.field}:${action.value}`;
    case "create_repo":
      return `create_repo:${action.project ?? "_"}:${action.name}`;
    case "dispatch_claude_code":
      return `dispatch_claude_code:${action.project}:${action.summary}`;
    case "handoff":
      return `handoff:${action.project}:${action.toEmployee}:${action.brief.slice(0, 64)}`;
  }
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
 * end-of-input. Other action languages don't use the pipe form; they continue
 * to work because they have no `|` values.
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
    // Top-level keys start at column 0 — leading whitespace marks a
    // continuation of a previous multi-line block (rare since we usually
    // consume the block fully) or a stray indented line we skip.
    const m = line.match(/^([a-zA-Z_]+)\s*:\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1].toLowerCase();
    const rawValue = m[2];

    if (rawValue.trim() === "|") {
      // Multi-line block follows.
      i++;
      const collected: string[] = [];
      let baseIndent: number | null = null;
      while (i < lines.length) {
        const next = lines[i];
        // Unindented top-level key terminates the block.
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
      // Trim leading and trailing blank lines.
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

const VALID_EMPLOYEES: ReadonlySet<EmployeeId> = new Set<EmployeeId>([
  "nora",
  "iris",
  "theo",
  "dex",
]);

function parseCast(f: Record<string, string>): ParsedAction | null {
  const employee = f.employee?.toLowerCase() as EmployeeId | undefined;
  if (!employee || !VALID_EMPLOYEES.has(employee)) return null;
  if (!f.project || !f.task || !f.reason) return null;
  return {
    type: "cast",
    employee,
    project: f.project,
    task: f.task,
    reason: f.reason,
  };
}

function parseCreateProject(f: Record<string, string>): ParsedAction | null {
  if (!f.name || !f.initial_goal || !f.reason) return null;
  return {
    type: "create_project",
    name: f.name,
    initialGoal: f.initial_goal,
    reason: f.reason,
  };
}

function parseRenameProject(f: Record<string, string>): ParsedAction | null {
  if (!f.project || !f.new_name) return null;
  return {
    type: "rename_project",
    project: f.project,
    newName: f.new_name,
  };
}

const VALID_BRIEFING_FIELDS: ReadonlySet<string> = new Set<BriefingField>([
  "goal",
  "state",
  "nextMove",
  "why",
]);

function parseUpdateBriefing(f: Record<string, string>): ParsedAction | null {
  if (!f.project || !f.field || !f.value) return null;
  // Accept both nextMove and next_move defensively — Claude sometimes drifts.
  const fieldNorm = f.field === "next_move" ? "nextMove" : f.field;
  if (!VALID_BRIEFING_FIELDS.has(fieldNorm)) return null;
  return {
    type: "update_briefing",
    project: f.project,
    field: fieldNorm as BriefingField,
    value: f.value,
  };
}

function parseCreateRepo(f: Record<string, string>): ParsedAction | null {
  if (!f.name) return null;
  // Default private; only flip on explicit "false".
  const isPrivate = (f.private?.toLowerCase() ?? "true") !== "false";
  return {
    type: "create_repo",
    project: f.project,
    name: f.name,
    description: f.description ?? "",
    isPrivate,
  };
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

function parseHandoff(f: Record<string, string>): ParsedAction | null {
  const toEmployee = f.to?.toLowerCase() as EmployeeId | undefined;
  if (!toEmployee || !VALID_EMPLOYEES.has(toEmployee)) return null;
  if (!f.project || !f.brief) return null;
  return {
    type: "handoff",
    toEmployee,
    project: f.project,
    brief: f.brief,
  };
}
