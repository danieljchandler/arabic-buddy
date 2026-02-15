import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: ReactNode;
  className?: string;
  /** Use compact padding for learning/review screens */
  compact?: boolean;
}

/**
 * AppShell - Consistent layout wrapper for all pages
 * 
 * Provides unified spacing and the watercolor SVG background.
 * Use compact mode for immersive learning screens.
 */
export function AppShell({ children, className, compact = false }: AppShellProps) {
  return (
    <div className={cn("min-h-screen lahja-paper relative", className)}>
      <div className="absolute inset-x-0 top-0 px-5 pt-4">
        <div className="lahja-divider opacity-90" />
      </div>
      <div className="absolute inset-x-0 bottom-0 px-5 pb-4">
        <div className="lahja-divider-subtle" />
      </div>
      <div className={cn(
        "relative mx-auto w-full max-w-2xl",
        compact ? "px-5 py-8" : "px-6 py-10 md:py-14"
      )}>
        {children}
      </div>
    </div>
  );
}
