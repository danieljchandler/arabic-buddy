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
 * It also owns Cmd/Ctrl+K, the assistant's global keyboard opener. The
 * shortcut lives here rather than on the floating sadu disc (AskAiFab) so the
 * two ways in stay independent: the disc had a spell off-screen — removed for
 * covering the bottom bar before coming back above it — and the keystroke
 * must not disappear with it. Both share this route list, so neither can open
 * a tutor over the sign-in form or the admin console.
 * (Cmd+/ belongs to feedback.)
 */
export function AssistantMount() {
  const { isOpen, openChat, close } = useAiAssistant();
  const [everOpened, setEverOpened] = useState(false);
  const { pathname } = useLocation();

  // The routes the assistant has nothing to say about — mirrored in AskAiFab,
  // kept so a stray keystroke can't open a tutor over the sign-in form or the
  // admin console.
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
