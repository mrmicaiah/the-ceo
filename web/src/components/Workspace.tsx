// The workspace's inner content. Two shapes:
//   - CEO workspace: a single ChatView for the CEO chat, full-bleed.
//   - Project workspace: chat tabs row + chat grid + briefing rail.

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { getBriefing } from "../lib/api";
import { useStore } from "../state/store";
import { ChatGrid } from "./ChatGrid";
import { ChatTabsRow } from "./ChatTabsRow";
import { ChatView } from "./ChatView";
import { WorkspaceBriefingRail } from "./WorkspaceBriefingRail";
import type {
  Briefing,
  WorkspaceId,
  WorkspaceState,
} from "../types";

interface Props {
  workspaceId: WorkspaceId;
}

export function Workspace({ workspaceId }: Props) {
  const { state } = useStore();
  const workspace = state.workspaces.find((w) => w.id === workspaceId);

  if (!workspace) return <NoSuchWorkspace />;
  if (workspace.id === "ceo") return <CeoWorkspaceContent />;
  return <ProjectWorkspaceContent workspace={workspace} />;
}

function NoSuchWorkspace() {
  return (
    <div className="h-full flex items-center justify-center px-10">
      <div className="max-w-[420px] text-center">
        <div className="font-display text-2xl text-ink leading-tight">
          That workspace isn't open.
        </div>
        <p className="mt-3 text-[14px] text-muted leading-relaxed">
          Open it from the left rail to bring it back.
        </p>
      </div>
    </div>
  );
}

function CeoWorkspaceContent() {
  const { state } = useStore();
  return (
    <div className="h-full">
      <ChatView kind="ceo" chatId={state.ceoChatId} />
    </div>
  );
}

function ProjectWorkspaceContent({ workspace }: { workspace: WorkspaceState }) {
  const projectId = workspace.projectId;
  const { minimizeChat, restoreChat, closeChat, touchChat } = useStore();

  // Per-workspace briefing fetch (no longer global). Refetch when projectId
  // changes (e.g., a different project workspace becomes active and re-uses
  // this component instance — but in practice we key by workspace.id so the
  // mount is unique per workspace).
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [briefingError, setBriefingError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let canceled = false;
    setBriefing(null);
    setBriefingError(null);
    (async () => {
      try {
        const b = await getBriefing(projectId);
        if (!canceled) setBriefing(b);
      } catch (err) {
        if (!canceled) setBriefingError((err as Error).message);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [projectId]);

  if (!projectId) return <NoSuchWorkspace />;

  const visibleChats = workspace.openChats.filter((c) => c.visible);
  const hasAnyChats = workspace.openChats.length > 0;

  const onTabActivate = (chatId: string) => {
    const target = workspace.openChats.find((c) => c.chatId === chatId);
    if (!target) return;
    if (!target.visible) {
      restoreChat(workspace.id, chatId);
    } else {
      // Already visible — just bump LRU so a later open doesn't push it out.
      touchChat(workspace.id, chatId);
    }
  };

  return (
    <div className="h-full flex">
      <div className="flex-1 flex flex-col min-w-0">
        <ChatTabsRow
          openChats={workspace.openChats}
          onActivate={onTabActivate}
          onClose={(chatId) => closeChat(workspace.id, chatId)}
        />
        {hasAnyChats && visibleChats.length === 0 ? (
          <MinimizedOnlyState />
        ) : visibleChats.length === 0 ? (
          <EmptyChatGridState />
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={`grid-${visibleChats.length}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="flex-1 min-h-0 flex flex-col"
            >
              <ChatGrid
                workspaceId={workspace.id}
                projectId={projectId}
                visibleChats={visibleChats}
                onMinimize={(chatId) => minimizeChat(workspace.id, chatId)}
                onClose={(chatId) => closeChat(workspace.id, chatId)}
                onTouch={(chatId) => touchChat(workspace.id, chatId)}
                onBriefingUpdate={(b) => setBriefing(b)}
              />
            </motion.div>
          </AnimatePresence>
        )}
      </div>
      <WorkspaceBriefingRail
        workspace={workspace}
        briefing={briefing}
        briefingError={briefingError}
        onBriefingFetched={(b) => setBriefing(b)}
      />
    </div>
  );
}

function EmptyChatGridState() {
  return (
    <div className="flex-1 flex items-center justify-center px-10">
      <div className="max-w-[460px] text-center">
        <div className="font-display text-2xl text-ink leading-tight">
          No chats open on this project.
        </div>
        <p className="mt-3 text-[14px] text-muted leading-relaxed">
          Talk to the CEO and ask for who to cast. The CEO can suggest a
          colleague and open them onto this project from the chat above.
        </p>
      </div>
    </div>
  );
}

function MinimizedOnlyState() {
  return (
    <div className="flex-1 flex items-center justify-center px-10">
      <div className="max-w-[420px] text-center">
        <div className="text-[14px] text-muted leading-relaxed italic">
          All chats minimized. Click a tab above to restore one.
        </div>
      </div>
    </div>
  );
}
