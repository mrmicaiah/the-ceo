import type { EmployeeId } from "../types";

// Display names for the four employees. Mirrored client-side so the UI can
// render speaker labels without a round-trip to /api/employees/:id/profile.
export const CHARACTER_NAMES: Record<EmployeeId, string> = {
  nora: "Nora",
  iris: "Iris",
  theo: "Theo",
  dex: "Dex",
};

export const CHARACTER_ROLES: Record<EmployeeId, string> = {
  nora: "Brainstormer",
  iris: "Critic",
  theo: "Researcher",
  dex: "Builder",
};
