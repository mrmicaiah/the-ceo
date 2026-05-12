// v3 NewProjectModal — create a new GitHub repo + claim it as a project
// in one flow. Resurrected from v1 but simpler: no goal field (goal lives
// in .ceo/goal.md once claimed), no repo-path field (the repo IS the
// project). Just name (required), description (optional), private
// (default true).
//
// On submit: POST /api/projects/new → server creates the repo, scaffolds
// .ceo/, returns ClaimResult → modal closes, workspace opens.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { createNewProject } from "../lib/api";
import { useStore } from "../state/store";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NewProjectModal({ open, onClose }: Props) {
  const { openProject } = useStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setIsPrivate(true);
      setError(null);
      setPending(false);
      // Focus the name field on open.
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  // Escape to close, when not pending.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onClose]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await createNewProject({
        name: trimmed,
        description: description.trim() || undefined,
        isPrivate,
      });
      openProject(result.projectId, result.repoFullName);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-30 flex items-center justify-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !pending) onClose();
          }}
        >
          <div className="absolute inset-0 bg-ink/30" />
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="relative w-full max-w-[460px] mx-4 bg-bg border border-divider rounded-sm shadow-md"
          >
            <form onSubmit={onSubmit} className="px-7 py-7">
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted mb-2">
                New project
              </div>
              <div className="font-display text-3xl text-ink leading-tight">
                What are we starting?
              </div>

              <div className="mt-7 flex flex-col gap-6">
                <Field label="Name">
                  <input
                    ref={nameRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={pending}
                    placeholder="repo name"
                    className="w-full bg-transparent outline-none border-0 border-b border-divider focus:border-ink text-[15px] text-ink py-1 transition-colors"
                  />
                </Field>
                <Field label="Description">
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={pending}
                    placeholder="optional"
                    className="w-full bg-transparent outline-none border-0 border-b border-divider focus:border-ink text-[15px] text-ink py-1 transition-colors"
                  />
                </Field>
                <label className="flex items-center gap-2 text-[13px] text-muted">
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                    disabled={pending}
                  />
                  <span>Private repo</span>
                </label>
              </div>

              <div className="mt-7 flex items-center justify-between">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={pending}
                  className="text-[13px] text-muted hover:text-ink transition-colors"
                >
                  Cancel
                </button>
                {error && (
                  <span className="text-[12px] text-muted">{error}</span>
                )}
                <button
                  type="submit"
                  disabled={pending || !name.trim()}
                  className="text-[13px] text-accent disabled:opacity-50 hover:underline underline-offset-2"
                >
                  {pending ? "creating…" : "Create project →"}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted mb-2">
        {label}
      </div>
      {children}
    </div>
  );
}
