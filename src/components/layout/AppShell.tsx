import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MajlisPattern } from "./MajlisPattern";

interface AppShellProps {
  children: ReactNode;
  className?: string;
  /** Use compact padding for learning/review screens */
  compact?: boolean;
  /** Hide background patterns (useful for focused screens) */
  hidePattern?: boolean;
}

/**
 * AppShell - Consistent layout wrapper for all pages
 * 
 * Provides unified spacing, the warm sand background, and subtle majlis patterns.
 * Use compact mode for immersive learning screens.
 */
export function AppShell({ children, className, compact = false, hidePattern = false }: AppShellProps) {
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
      {/* Subtle majlis-inspired background patterns */}
      {!hidePattern && <MajlisPattern />}
      
      <div className={cn(
        "relative mx-auto w-full max-w-2xl",
        compact ? "px-5 py-6" : "px-6 py-8 md:py-12"
      )}>
        {children}
      </div>
    </div>
  );
}
