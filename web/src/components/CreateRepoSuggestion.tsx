// Inline affordance for the CEO's create_repo suggestion. Same family as
// CastSuggestion. On click: POST /api/github/create-repo. On success: shows
// a small note linking to the new repo; if a projectId was attached, the
// project's repoPath is updated in the rail.
//
// Handles 422 (name collision) gracefully: "That name is already taken. The
// CEO can suggest a different one."

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { createGithubRepo, getProject } from "../lib/api";
import { useStore } from "../state/store";
import { ApiError } from "../lib/api";

interface Props {
  name: string;
  description: string;
  isPrivate: boolean;
  project: string | undefined;
}

export function CreateRepoSuggestion({ name, description, isPrivate, project }: Props) {
  const { state, updateProjectLocal } = useStore();
  const [phase, setPhase] = useState<"idle" | "pending" | "done" | "error">(
    "idle",
  );
  const [htmlUrl, setHtmlUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // If the attached project already has a repoPath, treat as already created.
  // The user can revisit old messages without re-firing.
  const attachedProject = useMemo(
    () => (project ? state.projects.find((p) => p.id === project) : undefined),
    [state.projects, project],
  );

  useEffect(() => {
    if (
      phase === "idle" &&
      attachedProject &&
      attachedProject.repoPath &&
      attachedProject.repoPath.trim().length > 0
    ) {
      setPhase("done");
      setHtmlUrl(attachedProject.repoPath);
    }
  }, [attachedProject, phase]);

  const onClick = async () => {
    if (phase === "pending" || phase === "done") return;
    setPhase("pending");
    setError(null);
    try {
      const created = await createGithubRepo({
        name,
        description,
        isPrivate,
        projectId: project,
      });
      setHtmlUrl(created.htmlUrl);
      // If we attached to a project, refresh that project so the rail (and
      // anyone reading its repoPath) sees the new value.
      if (project) {
        const refreshed = await getProject(project).catch(() => null);
        if (refreshed) updateProjectLocal(refreshed);
      }
      setPhase("done");
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setError("That name is already taken. The CEO can suggest a different one.");
      } else {
        setError((err as Error).message);
      }
      setPhase("error");
    }
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {phase === "done" ? (
        <motion.div
          key="note"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="my-4 text-[13px] text-muted italic"
        >
          Created repository{" "}
          {htmlUrl ? (
            <a
              href={htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="not-italic text-accent underline underline-offset-2"
            >
              {prettyRepoLabel(htmlUrl, name)}
            </a>
          ) : (
            <span className="not-italic text-ink">{name}</span>
          )}
          .
        </motion.div>
      ) : (
        <motion.aside
          key="card"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="my-5 border border-divider rounded-sm bg-surface/40 px-5 py-4 max-w-prose"
        >
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted mb-2">
            Suggested repository
          </div>
          <div className="flex items-baseline gap-3">
            <div className="font-display text-xl text-ink leading-tight font-mono-fallback">
              {name}
            </div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">
              {isPrivate ? "Private" : "Public"}
            </div>
          </div>
          {description && (
            <p className="mt-2 text-[14px] text-ink leading-relaxed">{description}</p>
          )}
          {attachedProject && (
            <div className="mt-1 text-[12px] text-muted italic leading-relaxed">
              For project: {attachedProject.name}
            </div>
          )}

          <div className="mt-3 flex items-center gap-4">
            <button
              onClick={onClick}
              disabled={phase === "pending"}
              className="text-[13px] text-accent disabled:opacity-50 hover:underline underline-offset-2"
            >
              {phase === "pending" ? "creating…" : "Create repository →"}
            </button>
            {error && (
              <span className="text-[12px] text-muted leading-snug">{error}</span>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function prettyRepoLabel(htmlUrl: string, fallbackName: string): string {
  // For a GitHub URL like https://github.com/owner/repo, show owner/repo.
  const match = htmlUrl.match(/github\.com\/([^/]+\/[^/?#]+)/);
  return match?.[1] ?? fallbackName;
}
