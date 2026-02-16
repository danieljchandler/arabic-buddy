import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import extendedBannerImg from "@/assets/extended-banner.png";

interface AppShellProps {
  children: ReactNode;
  className?: string;
  /** Use compact padding for learning/review screens */
  compact?: boolean;
}

/**
 * AppShell - Consistent layout wrapper for all pages
 *
 * Provides unified spacing, full-page Sadu geometric background, and Sadu banner.
 * Use compact mode for immersive learning screens.
 */
export function AppShell({ children, className, compact = false }: AppShellProps) {
  return (
    <div
      className={cn("min-h-screen relative", className)}
      style={{
        backgroundColor: "#FFFFFF",
        backgroundImage: `url(${extendedBannerImg})`,
        backgroundSize: "100% 100vh",
        backgroundPosition: "top center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className={cn(
        "relative mx-auto w-full max-w-2xl",
        compact ? "px-5 py-6" : "px-6 pt-4 pb-8 md:pt-6 md:pb-12"
      )}>
        {children}
      </div>
    </div>
  );
}
