import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAiAssistant } from "@/contexts/AiAssistantContext";

const AskAiPanel = lazy(() =>
  import("./AskAiPanel").then((m) => ({ default: m.AskAiPanel })),
);

/**
 * Mounts the Ask AI panel lazily: the chunk (panel + tappable-text machinery)
 * is only fetched the first time the assistant is opened, and stays mounted
 * afterwards so the conversation survives closing the sheet.
 *
 * It also owns Cmd/Ctrl+K, the assistant's one global opener. That shortcut
 * used to live on the floating sadu disc, which sat on top of the bottom bar
 * at tablet widths — a button covering the navigation is worse than no button,
 * and the assistant is already offered where it is actually wanted: the Ask AI
 * chip on a sentence, a tapped word, the phrase of the day. The keystroke
 * outlives the button because nothing was covering anything.
 * (Cmd+/ belongs to feedback.)
 */
export function AssistantMount() {
  const { isOpen, openChat, close } = useAiAssistant();
  const [everOpened, setEverOpened] = useState(false);
  const { pathname } = useLocation();

  // The routes the assistant has nothing to say about — the same list the
  // button carried, kept so a stray keystroke can't open a tutor over the
  // sign-in form or the admin console.
  const off = useMemo(
    () =>
      pathname.startsWith("/auth") ||
      pathname.startsWith("/onboarding") ||
      pathname.startsWith("/admin") ||
      pathname.startsWith("/reset-password"),
    [pathname],
  );

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
