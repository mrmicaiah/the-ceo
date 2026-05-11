// Centered modal for creating a project. Replaces the old in-pane form.
// On submit: createProject → addProject locally → openWorkspace(newId)
// (which also switches active to it). Modal closes. Cancel just closes.
//
// Restraint per docs/design.md: backdrop is a low-opacity ink wash, the
// modal itself is a paper-toned card with hairline border, fields are
// underline-only (no boxy inputs).

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { createProject } from "../lib/api";
import { useStore } from "../state/store";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NewProjectModal({ open, onClose }: Props) {
  const { addProject, openWorkspace } = useStore();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Reset when opening fresh and autofocus.
  useEffect(() => {
    if (open) {
      setName("");
      setGoal("");
      setRepoPath("");
      setPending(false);
      setError(null);
      requestAnimationFrame(() => nameRef.current?.focus());
    }
  }, [open]);

  // Escape key closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onClose]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const created = await createProject({
        name: name.trim(),
        initialGoal: goal.trim() || undefined,
        repoPath: repoPath.trim() || undefined,
      });
      addProject(created);
      openWorkspace(created.id, /* activate */ true);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-ink/30"
            onClick={() => {
              if (!pending) onClose();
            }}
            aria-hidden
          />
          {/* Modal card */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="relative w-full max-w-[580px] mx-6 bg-bg border border-divider rounded-sm shadow-[0_20px_60px_-20px_rgba(28,26,23,0.25)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-heading"
          >
            <div className="px-10 py-10">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted mb-3">
                New project
              </div>
              <h1
                id="new-project-heading"
                className="font-display text-3xl text-ink mb-7 leading-tight"
              >
                What are we starting?
              </h1>

              <form onSubmit={onSubmit} className="space-y-6">
                <Field label="Name">
                  <input
                    ref={nameRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="A short, recognisable name"
                    className="w-full bg-transparent border-b border-divider focus:border-ink outline-none py-2 text-[16px] text-ink placeholder:text-muted/70 transition-colors"
                  />
                </Field>

                <Field
                  label="Goal (optional)"
                  hint="What is this project, really? One sentence is plenty."
                >
                  <textarea
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    rows={2}
                    placeholder="Describe the goal in your own words"
                    className="w-full bg-transparent border-b border-divider focus:border-ink outline-none py-2 text-[15px] text-ink placeholder:text-muted/70 transition-colors leading-relaxed resize-none"
                  />
                </Field>

                <Field
                  label="Repo path (optional)"
                  hint="Absolute path on this machine — for Dex's runs later."
                >
                  <input
                    type="text"
                    value={repoPath}
                    onChange={(e) => setRepoPath(e.target.value)}
                    placeholder="C:\Users\you\Projects\something"
                    className="w-full bg-transparent border-b border-divider focus:border-ink outline-none py-2 text-[15px] text-ink placeholder:text-muted/70 font-mono transition-colors"
                  />
                </Field>

                {error && <div className="text-[13px] text-muted">{error}</div>}

                <div className="flex items-center gap-6 pt-1">
                  <button
                    type="submit"
                    disabled={pending || !name.trim()}
                    className="text-[14px] text-accent disabled:opacity-40 hover:underline underline-offset-2"
                  >
                    {pending ? "creating…" : "Create project →"}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="text-[13px] text-muted hover:text-ink transition-colors"
                    disabled={pending}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="font-display text-[14px] text-ink mb-1">{label}</div>
      {hint && <div className="text-[12px] text-muted mb-2 leading-snug">{hint}</div>}
      {children}
    </label>
  );
}
