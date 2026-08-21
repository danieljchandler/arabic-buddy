import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AppBackdrop } from "@/components/layout/AppBackdrop";
import { AppDock, shouldShowDock } from "@/components/shell/AppDock";
import { FeedbackWidget } from "@/components/feedback/FeedbackWidget";
import { useAiAssistant } from "@/contexts/AiAssistantContext";

interface AppShellProps {
  children: ReactNode;
  className?: string;
  /** Use compact padding for learning/review screens */
  compact?: boolean;
}

/**
 * AppShell - Consistent layout wrapper for all pages
 *
 * Provides unified spacing with full-page Sadu border background.
 * Use compact mode for immersive learning screens.
 */
export function AppShell({ children, className, compact = false }: AppShellProps) {
  const { pathname } = useLocation();
  const showNav = shouldShowDock(pathname);
  // The Ask AI panel is non-modal, so the page has to make room for it rather
  // than sit underneath it.
  const { isOpen: aiOpen } = useAiAssistant();

  return (
    <div
      className={cn(
        "min-h-[100dvh] relative bg-background",
        "transition-[padding] duration-300 ease-lahja motion-reduce:transition-none",
        // Clear the nav rail. From lg the dock stands up as a 5rem column down
        // the left edge (see AppDock), and it is fixed — so the page has to
        // make room for it or the centred content sits under it. Same
        // condition as the dock's own visibility: immersive routes hide it and
        // get the full width back.
        showNav && "lg:pl-20",
        // Only from lg: below that there isn't room to inset without squeezing
        // the text column, so the rail simply overlaps (still readable — no scrim).
        aiOpen && "lg:pr-[28rem]",
        className,
      )}
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <AppBackdrop />
      <div
        style={{
          // Clear the sadu band. It is part of a background-size: cover image,
          // so its on-screen height tracks the viewport — a fixed pt-4 clears
          // it on a phone and is buried by it on a desktop, which is what put
          // the emblem and the back link on top of the pattern at width.
          paddingTop: `calc(var(--sadu-band-height) + ${compact ? "0.75rem" : "1rem"})`,
        }}
        className={cn(
        "relative mx-auto w-full max-w-2xl animate-fade-up",
        compact ? "px-4 pb-5 sm:px-5 sm:pb-6" : "px-4 pb-8 sm:px-6 md:pb-12",
        // Clearance for the dock AND the Ask AI FAB, at every width. The md:
        // variant above is a separate group as far as tailwind-merge is
        // concerned, so a bare value loses to md:pb-12 from 768px up — the
        // clearance is stated at both widths. On phones the FAB floats at
        // bottom-20 and is 40px tall, so it reaches ~120px up from the edge:
        // pb-24 (96px) left it sitting on whatever ended a page — the Start
        // a lesson button on My Words, the empty-state copy on Discover.
        // 128px lets every page scroll its last element clear of it. From md
        // the FAB drops to bottom-6 and pb-24 already clears it. From lg there
        // is no bottom bar at all — the dock is a left rail — so the page only
        // needs to clear the FAB.
        showNav && "pb-32 md:pb-24 lg:pb-16",
        // Let the page scroll clear of the bottom sheet, or its lower half is
        // unreachable while the panel is open.
        aiOpen && "max-sm:pb-[60dvh]",
      )}>
        {children}
      </div>
      <AppDock />
      <FeedbackWidget />
      {/* The Ask AI FAB is mounted once at the app root (App.tsx) so it also
          reaches the pages that don't wrap themselves in AppShell. */}
    </div>
  );
}

