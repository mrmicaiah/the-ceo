// Used when there's truly nothing to show — kept simple. The actual first-
// message greeting in a brand-new CEO chat is rendered inline in MessageList.
// This is the deeper empty state (e.g., a route resolved to nothing real).

interface Props {
  title?: string;
  body?: string;
}

export function EmptyState({
  title = "Nothing here yet",
  body = "Open the CEO to start a project.",
}: Props) {
  return (
    <div className="h-full flex items-center justify-center px-10">
      <div className="max-w-[420px] text-center">
        <div className="font-display text-3xl text-ink leading-tight">{title}</div>
        <p className="mt-3 text-[14px] text-muted leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
