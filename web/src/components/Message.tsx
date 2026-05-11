// A single message in the transcript. Renders markdown for assistant
// messages (paragraphs, emphasis, code, lists) and intercepts every fenced
// action block (```cast, ```create_project, ```rename_project,
// ```update_briefing, ```create_repo), replacing them with their
// corresponding affordance or note component.

import { useMemo, type ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CastSuggestion } from "./CastSuggestion";
import { CreateProjectSuggestion } from "./CreateProjectSuggestion";
import { CreateRepoSuggestion } from "./CreateRepoSuggestion";
import { RenameNote } from "./RenameNote";
import { BriefingUpdateNote } from "./BriefingUpdateNote";
import { ACTION_LANGS, parseActionBlock, type ParsedAction } from "../lib/actions";

interface Props {
  role: "user" | "assistant" | "system";
  content: string;
  speakerLabel: string;
  streaming?: boolean;
  sourceChatId: string;
}

export function Message({ role, content, speakerLabel, streaming, sourceChatId }: Props) {
  const isUser = role === "user";

  return (
    <article>
      <header className="mb-3 flex items-baseline gap-3">
        <span
          className={`font-display text-[15px] tracking-tight ${
            isUser ? "text-accent" : "text-ink"
          }`}
        >
          {speakerLabel}
        </span>
        {streaming && (
          <span className="text-[11px] text-muted ink-pulse">writing</span>
        )}
      </header>
      <div className={`text-ink leading-relaxed ${isUser ? "" : "max-w-prose"}`}>
        {isUser ? (
          <UserContent content={content} />
        ) : (
          <AssistantContent
            content={content}
            sourceChatId={sourceChatId}
            isLive={!!streaming}
          />
        )}
      </div>
    </article>
  );
}

function UserContent({ content }: { content: string }) {
  // User messages are plain text — preserve newlines, no markdown.
  return <div className="whitespace-pre-wrap break-words">{content}</div>;
}

function AssistantContent({
  content,
  sourceChatId,
  isLive,
}: {
  content: string;
  sourceChatId: string;
  isLive: boolean;
}) {
  // Memoize the markdown tree on content so unrelated re-renders don't
  // re-parse. Note: action components themselves carry their own per-mount
  // state, so re-rendering them is fine; we only want to avoid the markdown
  // parser running unnecessarily.
  return useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className="mb-4 last:mb-0 leading-relaxed">{children}</p>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          strong: ({ children }) => (
            <strong className="font-semibold text-ink">{children}</strong>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-6 mb-4 space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-6 mb-4 space-y-1">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l border-divider pl-4 italic text-muted my-4">
              {children}
            </blockquote>
          ),
          h1: ({ children }) => (
            <h2 className="font-display text-xl mt-6 mb-3 text-ink">{children}</h2>
          ),
          h2: ({ children }) => (
            <h3 className="font-display text-lg mt-6 mb-2 text-ink">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="font-display text-base mt-5 mb-2 text-ink">{children}</h4>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2"
            >
              {children}
            </a>
          ),
          pre: ({ children }) => {
            // If a child is one of our action blocks, bypass the <pre>
            // wrapper so the affordance isn't shrouded in code styling.
            const child = Array.isArray(children) ? children[0] : children;
            const className =
              child &&
              typeof child === "object" &&
              "props" in (child as object)
                ? String(
                    (child as ReactElement<{ className?: string }>).props
                      .className ?? "",
                  )
                : "";
            const langMatch = className.match(/language-(\w+)/);
            if (langMatch && ACTION_LANGS.has(langMatch[1])) {
              return <>{children}</>;
            }
            return (
              <pre className="font-mono text-[13px] bg-surface/60 border border-divider rounded-sm p-3 my-4 overflow-x-auto">
                {children}
              </pre>
            );
          },
          code: ({ className, children }) => {
            const match = /language-(\w+)/.exec(className ?? "");
            const lang = match?.[1];
            const text = Array.isArray(children)
              ? children.join("")
              : String(children ?? "");

            if (lang && ACTION_LANGS.has(lang)) {
              const action = parseActionBlock(lang, text);
              if (action) {
                return (
                  <ActionRenderer
                    action={action}
                    sourceChatId={sourceChatId}
                    isLive={isLive}
                  />
                );
              }
              // Action block didn't parse — fall through to plain code rendering
              // so the user sees what was attempted.
            }

            if (lang) {
              return <code className="font-mono text-[13px]">{children}</code>;
            }
            return (
              <code className="font-mono text-[0.9em] text-ink bg-surface/70 border border-divider rounded-sm px-1 py-px">
                {children}
              </code>
            );
          },
          hr: () => <hr className="my-6 border-divider" />,
        }}
      >
        {content}
      </ReactMarkdown>
    ),
    [content, sourceChatId, isLive],
  );
}

function ActionRenderer({
  action,
  sourceChatId,
  isLive,
}: {
  action: ParsedAction;
  sourceChatId: string;
  isLive: boolean;
}) {
  switch (action.type) {
    case "cast":
      return (
        <CastSuggestion
          employee={action.employee}
          project={action.project}
          task={action.task}
          reason={action.reason}
          sourceChatId={sourceChatId}
        />
      );
    case "create_project":
      return (
        <CreateProjectSuggestion
          name={action.name}
          initialGoal={action.initialGoal}
          reason={action.reason}
        />
      );
    case "rename_project":
      return (
        <RenameNote
          project={action.project}
          newName={action.newName}
          isLive={isLive}
        />
      );
    case "update_briefing":
      return (
        <BriefingUpdateNote
          project={action.project}
          field={action.field}
          value={action.value}
          isLive={isLive}
        />
      );
    case "create_repo":
      return (
        <CreateRepoSuggestion
          name={action.name}
          description={action.description}
          isPrivate={action.isPrivate}
          project={action.project}
        />
      );
  }
}
