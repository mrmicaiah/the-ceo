// A single project row in the left rail. Carries three pieces of state:
//   - open?    workspace tab exists at the top
//   - active?  is THE current workspace (also implies open)
//   - editing? rename mode
//
// Visual:
//   - open + inactive: ink + 1px accent left-edge bar
//   - open + active:   ink (bold) + 1px accent left-edge bar
//   - closed:          muted, no bar
//
// Click on name:
//   - if closed: open + switch
//   - if open:   switch (no toggle off)
//
// Hover reveals on the right: lowercase muted "open"/"close" affordance
// (toggles workspace), plus a rename link.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { patchProject } from "../lib/api";
import { useStore } from "../state/store";
import { workspaceIdForProject, type ProjectListItem as ProjectListItemType } from "../types";

interface Props {
  project: ProjectListItemType;
  open: boolean;
  active: boolean;
}

export function ProjectListItem({ project, open, active }: Props) {
  const {
    updateProjectLocal,
    openWorkspace,
    closeWorkspace,
    switchWorkspace,
  } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(project.name);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, project.name]);

  const onNameClick = () => {
    if (!open) {
      openWorkspace(project.id, /* activate */ true);
    } else {
      switchWorkspace(workspaceIdForProject(project.id));
    }
  };

  const onToggleOpen = () => {
    if (open) {
      closeWorkspace(project.id);
    } else {
      openWorkspace(project.id, /* activate */ true);
    }
  };

  const startEdit = () => {
    if (pending) return;
    setEditing(true);
  };

  const commit = async () => {
    if (!editing) return;
    const next = draft.trim();
    if (!next || next === project.name) {
      setEditing(false);
      setDraft(project.name);
      return;
    }
    setPending(true);
    try {
      const updated = await patchProject(project.id, { name: next });
      updateProjectLocal(updated);
    } catch {
      // Silent fallback on error in v0 — the rail returns to the prior name.
    } finally {
      setEditing(false);
      setPending(false);
    }
  };

  const cancel = () => {
    setEditing(false);
    setDraft(project.name);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  return (
    <li className="group relative">
      {open && (
        <span
          aria-hidden
          className="absolute left-0 top-2 bottom-2 w-px bg-accent pointer-events-none"
        />
      )}

      {editing ? (
        <div className="px-3 py-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commit}
            disabled={pending}
            className="w-full bg-transparent font-display text-[15px] text-ink border-b border-ink outline-none disabled:opacity-50"
            aria-label={`Rename ${project.name}`}
          />
        </div>
      ) : (
        <>
          <button
            onClick={onNameClick}
            className="block w-full text-left px-3 py-2 hover:bg-surface/60 transition-colors"
          >
            <span
              className={`font-display text-[15px] ${
                open ? "text-ink" : "text-muted"
              } ${active ? "font-semibold" : ""}`}
            >
              {project.name}
            </span>
          </button>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={onToggleOpen}
              className="text-[11px] text-muted hover:text-ink"
              aria-label={open ? `Close ${project.name} workspace` : `Open ${project.name} workspace`}
            >
              {open ? "close" : "open"}
            </button>
            <button
              type="button"
              onClick={startEdit}
              className="text-[11px] text-muted hover:text-ink"
              aria-label={`Rename project ${project.name}`}
            >
              rename
            </button>
          </div>
        </>
      )}
    </li>
  );
}
