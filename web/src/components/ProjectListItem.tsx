// A single project row in the left rail. Two affordances on one line:
//   - the project name itself navigates (button)
//   - a small "rename" hover-reveal to the right enters edit mode
//
// Edit mode replaces the row with an inline text input styled to match the
// surrounding type. Enter commits, Escape cancels, blur commits. The input
// PATCHes /api/projects/:id and refreshes the store on success.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter, pathForEmployeeChat } from "../router";
import { patchProject } from "../lib/api";
import { useStore } from "../state/store";
import type { ProjectListItem as ProjectListItemType } from "../types";

interface Props {
  project: ProjectListItemType;
  active: boolean;
}

export function ProjectListItem({ project, active }: Props) {
  const { navigate } = useRouter();
  const { updateProjectLocal } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(project.name);
      // Autofocus + select the text so a single keystroke replaces.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, project.name]);

  const onNavigate = () => {
    navigate("/");
  };

  const startEdit = () => {
    if (pending) return;
    setEditing(true);
  };

  const commit = async () => {
    if (!editing) return;
    const next = draft.trim();
    // No-op if empty or unchanged.
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
      // Silent on error in v0 — the rail returns to the prior name. Could
      // surface a toast later when we have a notification surface.
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
      {active && (
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
            onClick={onNavigate}
            className="block w-full text-left px-3 py-2 hover:bg-surface/60 transition-colors"
          >
            <span
              className={`font-display text-[15px] ${
                active ? "text-accent" : "text-ink"
              }`}
            >
              {project.name}
            </span>
          </button>
          <button
            type="button"
            onClick={startEdit}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted opacity-0 group-hover:opacity-100 hover:text-ink focus:opacity-100 transition-opacity"
            aria-label={`Rename project ${project.name}`}
          >
            rename
          </button>
        </>
      )}
    </li>
  );
}

// Helper: used by other components that need to compute a chat URL.
export { pathForEmployeeChat };
