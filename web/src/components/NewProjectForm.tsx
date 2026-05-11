// Inline editorial form for creating a project. Not a modal — appears in the
// main pane like a sheet of paper on the desk. After submit, the new project
// shows in the rail and the user is returned to the CEO chat (which now
// knows about the project on its next message).

import { useState, type FormEvent } from "react";
import { createProject } from "../lib/api";
import { useStore } from "../state/store";
import { useRouter } from "../router";

interface Props {
  onCancel: () => void;
  onCreated: () => void;
}

export function NewProjectForm({ onCancel, onCreated }: Props) {
  const { addProject } = useStore();
  const { navigate } = useRouter();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      navigate("/");
      onCreated();
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto" style={{ position: "relative", zIndex: 2 }}>
      <div className="max-w-[580px] mx-auto px-10 py-16">
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted mb-3">
          New project
        </div>
        <h1 className="font-display text-3xl text-ink mb-8 leading-tight">
          What are we starting?
        </h1>

        <form onSubmit={onSubmit} className="space-y-7">
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              placeholder="A short, recognisable name"
              className="w-full bg-transparent border-b border-divider focus:border-ink outline-none py-2 text-[16px] text-ink placeholder:text-muted/70 transition-colors"
            />
          </Field>

          <Field label="Goal (optional)" hint="What is this project, really? One sentence is plenty.">
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              placeholder="Describe the goal in your own words"
              className="w-full bg-transparent border-b border-divider focus:border-ink outline-none py-2 text-[15px] text-ink placeholder:text-muted/70 transition-colors leading-relaxed resize-none"
            />
          </Field>

          <Field label="Repo path (optional)" hint="Absolute path on this machine — for Dex's runs later.">
            <input
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              placeholder="/Users/you/Code/something"
              className="w-full bg-transparent border-b border-divider focus:border-ink outline-none py-2 text-[15px] text-ink placeholder:text-muted/70 font-mono transition-colors"
            />
          </Field>

          {error && (
            <div className="text-[13px] text-muted">{error}</div>
          )}

          <div className="flex items-center gap-6 pt-2">
            <button
              type="submit"
              disabled={pending || !name.trim()}
              className="text-[14px] text-accent disabled:opacity-40 hover:underline underline-offset-2"
            >
              {pending ? "creating…" : "Create project →"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="text-[13px] text-muted hover:text-ink transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
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
