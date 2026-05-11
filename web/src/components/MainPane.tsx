// Main pane router. Renders the CEO chat by default; an employee chat for
// /projects/:id/chat/:id; or the new-project form when triggered from the
// left rail.

import { motion, AnimatePresence } from "motion/react";
import { useRouter } from "../router";
import { ChatView } from "./ChatView";
import { NewProjectForm } from "./NewProjectForm";
import { useStore } from "../state/store";

interface Props {
  showNewProject: boolean;
  onCancelNewProject: () => void;
  onProjectCreated: () => void;
}

export function MainPane({ showNewProject, onCancelNewProject, onProjectCreated }: Props) {
  const { route } = useRouter();
  const { state } = useStore();

  // Stable key for AnimatePresence — changes when the view changes.
  const key = showNewProject
    ? "new-project"
    : route.kind === "home"
      ? `ceo:${state.ceoChatId}`
      : route.kind === "employee-chat"
        ? `chat:${route.chatId}`
        : "not-found";

  return (
    <div className="h-full w-full overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div
          key={key}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="h-full w-full"
        >
          {showNewProject ? (
            <NewProjectForm
              onCancel={onCancelNewProject}
              onCreated={onProjectCreated}
            />
          ) : route.kind === "home" ? (
            <ChatView
              key={state.ceoChatId}
              kind="ceo"
              chatId={state.ceoChatId}
            />
          ) : route.kind === "employee-chat" ? (
            <ChatView
              key={route.chatId}
              kind="employee"
              chatId={route.chatId}
              projectId={route.projectId}
            />
          ) : (
            <NotFound />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function NotFound() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <div className="font-display text-3xl text-ink">Not found</div>
        <div className="mt-2 text-sm text-muted">That route doesn't exist.</div>
      </div>
    </div>
  );
}
