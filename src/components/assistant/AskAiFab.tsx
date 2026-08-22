import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import art from "@/assets/sadu-ask.svg";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { cn } from "@/lib/utils";

/**
 * Floating "Ask AI" button, mounted in AppShell next to the feedback FAB.
 * Stacks above it (the feedback widget owns bottom-20 / md:bottom-6).
 * Cmd/Ctrl+K opens the assistant from anywhere (Cmd+/ belongs to feedback).
 * Must do no fetching on mount — the route sweep renders every page.
 */
export function AskAiFab({ className }: { className?: string }) {
  const { openChat, isOpen, close } = useAiAssistant();
  const { pathname } = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isOpen) close();
        else openChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, openChat, close]);

  const hidden = useMemo(
    () =>
      pathname.startsWith("/auth") ||
      pathname.startsWith("/onboarding") ||
      pathname.startsWith("/admin") ||
      pathname.startsWith("/reset-password"),
    [pathname],
  );

  if (hidden) return null;

  return (
    <button
      type="button"
      aria-label="Ask AI"
      data-feedback-ignore="true"
      onClick={() => openChat()}
      className={cn(
        "fixed right-3 bottom-20 z-40 flex flex-col items-center gap-1",
        "transition-transform hover:scale-105 active:scale-95",
        "md:bottom-6 md:right-6",
        className,
      )}
    >
      {/* The loud sadu cloth — the play button's rejected first face, kept in
          docs/branding because it wanted an element that can afford to be
          loud. This is that element. The Arabic question mark says what the
          button takes; see sadu-ask.svg for why it is painted, not cut. */}
      <img
        src={art}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="h-12 w-12 drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)]"
      />
      {/* The label rides its own chip rather than trusting whatever is behind
          the button — this floats over dark video and warm sand alike. */}
      <span className="rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold leading-none text-white backdrop-blur">
        Ask AI
      </span>
    </button>
  );
}
