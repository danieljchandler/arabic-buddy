import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import borderFullPageImg from "@/assets/border-full-page.png";
import { SaduBanner } from "@/components/design-system/SaduBanner";

interface AppShellProps {
  children: ReactNode;
  className?: string;
  /** Use compact padding for learning/review screens */
  compact?: boolean;
}

/**
 * AppShell - Consistent layout wrapper for all pages
 *
 * Provides unified spacing with parchment backdrop and Sadu border on top.
 * Use compact mode for immersive learning screens.
 */
export function AppShell({ children, className, compact = false }: AppShellProps) {
  return (
    <div className={cn("min-h-screen relative", className)} style={{ backgroundColor: "#FFFFFF" }}>
      {/* Parchment backdrop layer with reduced opacity */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: `url(${borderFullPageImg})`,
          backgroundSize: "cover",
          backgroundPosition: "top center",
          backgroundRepeat: "no-repeat",
          opacity: 0.55,
          pointerEvents: "none",
        }}
      />
      {/* Sadu border strip at the top */}
      <div className="relative z-10">
        <SaduBanner />
      </div>
      <div className={cn(
        "relative mx-auto w-full max-w-2xl",
        compact ? "px-5 py-6" : "px-6 pt-0 pb-8 md:pt-2 md:pb-12"
      )}>
        {children}
      </div>
    </div>
  );
}
