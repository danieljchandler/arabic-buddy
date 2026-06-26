import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import borderFullPageImg from "@/assets/border-full-page.png";
import { BottomNav, shouldShowBottomNav } from "@/components/layout/BottomNav";

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
  const showNav = shouldShowBottomNav(pathname);

  return (
    <div
      className={cn("min-h-[100dvh] relative bg-white", className)}
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
      <div className={cn(
        "relative mx-auto w-full max-w-2xl animate-fade-up",
        compact ? "px-4 py-5 sm:px-5 sm:py-6" : "px-4 pt-4 pb-8 sm:px-6 md:pt-6 md:pb-12",
        showNav && "pb-24"
      )}>
        {children}
      </div>
      <BottomNav />
    </div>
  );
}

