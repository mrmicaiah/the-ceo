// Parse ```cast fenced blocks the CEO emits.
//
// Format (per the CEO's system prompt):
//   ```cast
//   employee: nora | iris | theo | dex
//   project: <project_id>
//   task: <one-line task brief>
//   reason: <one-line reason for the user>
//   ```
//
// Returns null if the block can't be parsed cleanly. Callers then fall back
// to rendering the original text as a regular code block.

import type { EmployeeId } from "../types";

export interface ParsedCastBlock {
  employee: EmployeeId;
  project: string;
  task: string;
  reason: string;
}

const VALID: ReadonlySet<EmployeeId> = new Set<EmployeeId>([
  "nora",
  "iris",
  "theo",
  "dex",
]);

export function parseCastBlock(content: string): ParsedCastBlock | null {
  const fields: Partial<Record<string, string>> = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([a-zA-Z_]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (value) fields[key] = value;
  }

  const employee = fields.employee?.toLowerCase() as EmployeeId | undefined;
  const project = fields.project;
  const task = fields.task;
  const reason = fields.reason;

  if (!employee || !VALID.has(employee)) return null;
  if (!project || !task || !reason) return null;

  return { employee, project, task, reason };
}
