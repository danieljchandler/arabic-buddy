import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import borderFullPageImg from "@/assets/border-full-page.webp";
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
        "min-h-[100dvh] relative bg-white",
        "transition-[padding] duration-300 ease-lahja motion-reduce:transition-none",
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
      {/* Background image layer with reduced opacity */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: `url(${borderFullPageImg})`,
          backgroundSize: "cover",
          backgroundPosition: "top center",
          backgroundRepeat: "no-repeat",
          opacity: 0.95,
          pointerEvents: "none",
        }}
      />
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
        // Clearance for the dock, at every width. The md: variant above is a
        // separate group as far as tailwind-merge is concerned, so a bare
        // pb-24 loses to md:pb-12 from 768px up — which leaves 48px of room
        // under a bar that can be taller than that, putting whatever sits at
        // the bottom of a page underneath it. Ingleezy hit exactly this when
        // it swapped its bar; the clearance is stated at both widths.
        showNav && "pb-24 md:pb-24",
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

