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
    <div 
      className={cn("min-h-screen bg-background relative", className)}
      style={{
        backgroundImage: "url('/assets/lahja-watercolor-bg-subtle.svg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className={cn(
        "relative mx-auto w-full max-w-2xl",
        compact ? "px-5 py-6" : "px-6 py-8 md:py-12"
      )}>
        {children}
      </div>
    </div>
  );
}
