// The contents of the five starter files committed to a repo's .ceo/
// directory when it's claimed as a project. Values are verbatim from
// docs/runs/run-10-scaffold-content.md.
//
// These strings are committed to the user's actual GitHub repos as the
// first commit on behalf of the system. Treat them as durable artifacts:
// they will live in commit history, in clones, in forks. Wording
// changes here propagate forward to new claims only — existing repos
// keep their original scaffold until the user (or, later, the manager)
// edits.

export const CEO_README = `# .ceo — Manager's working memory

This directory is the persistent memory for the manager that works on this project. Files here are read by the manager on every session and updated as the project evolves.

These files are the source of truth for the project's substance — its goal, accumulated context, decisions made, and current state. The chat in our app is ephemeral; this directory is durable.

## Files

- \`goal.md\` — what this project is for, in the user's own words
- \`context.md\` — what the manager needs to know to be useful on this project (architecture decisions, conventions, constraints, history)
- \`decisions.md\` — log of significant decisions made over the life of the project, with dates and the reasoning
- \`board.md\` — the project's current state at a glance (where it is now, what's next, what's blocked). Updated regularly by the manager.

## Conventions

- Edit these files directly if you want; the manager respects what's there.
- The manager owns these files as housekeeping in its own workspace, but won't make destructive changes without your awareness.
- These files are committed to git like any other content. Their history is the project's intellectual history.
`;

export const CEO_GOAL = `# Goal

(Empty. The manager will ask about this on first session, or you can write it yourself.)

What is this project for? Why does it exist? When you describe what success looks like for this repo, what do you say?
`;

export const CEO_CONTEXT = `# Context

(Empty. Fill in as the project develops, or let the manager accumulate this through conversation.)

What does the manager need to know to be useful here? Architecture, conventions, technologies, history, constraints, who else is involved, anything that doesn't fit in goal.md or decisions.md.
`;

export const CEO_DECISIONS = `# Decisions

(Empty. Append entries as decisions are made.)

Format suggestion: each entry has a date, a short title, the decision itself, and why. Example:

## 2026-01-15 — Routing approach

Chose Remix-style file-system routing over a config-based router.

Why: matches the team's mental model from previous projects, and the config-based alternative was over-engineered for our scale.
`;

export const CEO_BOARD = `# Board

(Empty. The manager will update this regularly to reflect the project's current state.)

A glance view of where this project is right now:

**Goal:** (one sentence)
**State:** (one or two sentences)
**Next move:** (one strong phrase)
**Blockers:** (anything stuck or undecided)
`;
