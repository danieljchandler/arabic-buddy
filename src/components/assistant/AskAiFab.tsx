import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { SaduBubble } from "@/components/brand/SaduBubble";
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
        "fixed right-3 bottom-20 z-40 flex items-center gap-1.5 rounded-full",
        "bg-primary text-primary-foreground shadow-elegant transition-transform hover:scale-105",
        "md:bottom-6 md:right-6",
        "h-10 pe-3 ps-2.5",
        className,
      )}
    >
      {/* The mark is a speech bubble woven with sadu, not a sparkle: the logo
          is already a bubble with a sadu ring, and asking is what the button
          does. "simple" because the full band turns to mush at this size. */}
      <SaduBubble tone="ivory" className="h-[18px] w-auto shrink-0" />
      <span className="text-[13px] font-semibold leading-none tracking-tight">Ask AI</span>
    </button>
  );
}
