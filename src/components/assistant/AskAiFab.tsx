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
        "fixed right-3 bottom-20 z-40 rounded-full",
        "transition-transform hover:scale-105 active:scale-95",
        "md:bottom-6 md:right-6",
        className,
      )}
    >
      {/* The play button's disc — the weave pressed into dark glass, crimson
          hairline at the rim — with the question mark where the triangle goes.
          The two controls are siblings on the same screen, and a family
          resemblance says "this one asks" better than a labelled pill did. */}
      <img
        src={art}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="h-12 w-12 drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)]"
      />
    </button>
  );
}
