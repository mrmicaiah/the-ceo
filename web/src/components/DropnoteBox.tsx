// Dropnote box. Single-line text input anchored bottom-left of the app.
// Type, Enter, gone. Quiet acknowledgment (the placeholder flashes
// "captured" briefly). A small chevron at the right lets you peek at recent
// drops in a floating panel above the input.
//
// Stays small even when typing. No auto-grow. Editorial restraint per
// design.md: lowercase placeholder, muted, hairline rule below the input
// when typing.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { createDropnote, listDropnotes } from "../lib/api";
import type { Dropnote } from "../types";

export function DropnoteBox() {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [justCaptured, setJustCaptured] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [recent, setRecent] = useState<Dropnote[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      const created = await createDropnote(trimmed);
      setValue("");
      setJustCaptured(true);
      window.setTimeout(() => setJustCaptured(false), 1200);
      // If the expand panel is open, prepend the new drop optimistically.
      if (recent) setRecent([created, ...recent]);
    } catch {
      // Quiet failure — the placeholder won't flash "captured".
    } finally {
      setPending(false);
    }
  };

  const toggleExpand = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    setRecent(null);
    setRecentError(null);
    try {
      const items = await listDropnotes();
      setRecent(items.slice(0, 10));
    } catch (err) {
      setRecentError((err as Error).message);
    }
  };

  // Close the recent-drops panel on outside click.
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [expanded]);

  return (
    <div ref={wrapRef} className="relative max-w-[420px]">
      <form
        onSubmit={onSubmit}
        className="flex items-center gap-2"
      >
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={justCaptured ? "captured" : "drop a note..."}
          disabled={pending}
          className="flex-1 min-w-0 bg-transparent outline-none border-0 text-[13px] text-ink placeholder:text-muted placeholder:italic py-1"
          aria-label="Drop a note"
        />
        <button
          type="button"
          onClick={toggleExpand}
          className="text-[11px] text-muted hover:text-ink transition-colors px-1 leading-none"
          aria-label={expanded ? "Hide recent drops" : "Show recent drops"}
          title={expanded ? "Hide recent drops" : "Show recent drops"}
        >
          {expanded ? "˅" : "˄"}
        </button>
      </form>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18 }}
            className="absolute bottom-full mb-2 left-0 right-0 max-h-[40vh] overflow-y-auto bg-bg border border-divider rounded-sm shadow-md z-20"
          >
            <div className="px-4 py-2 text-[10px] uppercase tracking-[0.16em] text-muted border-b border-divider">
              Recent drops
            </div>
            {recentError ? (
              <div className="px-4 py-3 text-[12px] text-muted">
                {recentError}
              </div>
            ) : !recent ? (
              <div className="px-4 py-3 text-[12px] text-muted italic editorial-shimmer">
                loading
              </div>
            ) : recent.length === 0 ? (
              <div className="px-4 py-3 text-[12px] text-muted italic">
                Nothing dropped yet.
              </div>
            ) : (
              <ul>
                {recent.map((d) => (
                  <li
                    key={d.id}
                    className="px-4 py-2 border-b border-divider/50 last:border-b-0"
                  >
                    <div className="text-[13px] text-ink leading-snug whitespace-pre-wrap break-words">
                      {d.content}
                    </div>
                    <div className="text-[10px] text-muted mt-1">
                      {relativeTime(d.createdAt)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function relativeTime(iso: string): string {
  // ISO from D1: "YYYY-MM-DD HH:MM:SS" (no Z; UTC). Treat as UTC.
  const t = Date.parse(iso.replace(" ", "T") + "Z");
  if (!isFinite(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
