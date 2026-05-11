// Unified parser for every fenced action block the CEO emits.
//
// Format (per the CEO's system prompt):
//   ```cast
//   employee: nora | iris | theo | dex
//   project: <project_id>
//   task: <one line>
//   reason: <one line>
//   ```
//
//   ```create_project
//   name: <project name>
//   initial_goal: <goal>
//   reason: <user-facing reason>
//   ```
//
//   ```rename_project
//   project: <project_id>
//   new_name: <new name>
//   ```
//
//   ```update_briefing
//   project: <project_id>
//   field: goal | state | nextMove | why
//   value: <new value>
//   ```
//
//   ```create_repo
//   project: <project_id, optional>
//   name: <repo name>
//   description: <one line>
//   private: true | false
//   ```
//
// Returns null on any malformed input. Callers (Message.tsx) fall back to
// rendering the original text as a regular code block.

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
    };

export const ACTION_LANGS: ReadonlySet<string> = new Set([
  "cast",
  "create_project",
  "rename_project",
  "update_briefing",
  "create_repo",
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
  }
}

// ── Internals ──────────────────────────────────────────────────────────

function parseFields(content: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([a-zA-Z_]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (value.length) fields[key] = value;
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
