import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { isAssistantOffRoute } from "@/lib/assistantRoutes";

const AskAiPanel = lazy(() =>
  import("./AskAiPanel").then((m) => ({ default: m.AskAiPanel })),
);

/**
 * Mounts the Ask AI panel lazily: the chunk (panel + tappable-text machinery)
 * is only fetched the first time the assistant is opened, and stays mounted
 * afterwards so the conversation survives closing the sheet.
 *
 * It also owns Cmd/Ctrl+K, the assistant's global keyboard opener. The
 * shortcut lives here rather than on the floating sadu disc (AskAiFab) so the
 * two ways in stay independent: the disc had a spell off-screen — removed for
 * covering the bottom bar before coming back above it — and the keystroke
 * must not disappear with it. Both read ASSISTANT_OFF_ROUTES, so neither can
 * open a tutor over the sign-in form or the admin console — and neither can
 * drift from the other, which is what two copies of the list invited.
 * (Cmd+/ belongs to feedback.)
 */
export function AssistantMount() {
  const { isOpen, openChat, close } = useAiAssistant();
  const [everOpened, setEverOpened] = useState(false);
  const { pathname } = useLocation();

  // The routes the assistant has nothing to say about — the same list the
  // disc reads, so a stray keystroke can't open a tutor over the sign-in form
  // or the admin console.
  const off = isAssistantOffRoute(pathname);

  // A panel left open when the learner walks into the admin console (or signs
  // out onto /auth) is the assistant following them somewhere it is switched
  // off — the disc is gone, so there would be no way to open it again either.
  useEffect(() => {
    if (off && isOpen) close();
  }, [off, isOpen, close]);

  useEffect(() => {
    if (off) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isOpen) close();
        else openChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [off, isOpen, openChat, close]);

  useEffect(() => {
    if (isOpen) setEverOpened(true);
  }, [isOpen]);

  if (!everOpened) return null;

  return (
    <Suspense fallback={null}>
      <AskAiPanel />
    </Suspense>
  );
}
