import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: ReactNode;
  className?: string;
  /** Use compact padding for learning/review screens */
  compact?: boolean;
  /** Show decorative border at the very top of the page */
  showTopBorder?: boolean;
}

/**
 * AppShell - Consistent layout wrapper for all pages
 * 
 * Provides unified spacing and the watercolor SVG background.
 * Use compact mode for immersive learning screens.
 */
export function AppShell({ children, className, compact = false, showTopBorder = false }: AppShellProps) {
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
      {showTopBorder && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
          <div
            className="h-[42px] w-full border-b border-stone-700/60"
            style={{
              backgroundColor: "#866343",
              backgroundImage: `
                linear-gradient(45deg, rgba(239, 204, 144, 0.9) 25%, transparent 25%, transparent 75%, rgba(239, 204, 144, 0.9) 75%),
                linear-gradient(-45deg, rgba(146, 51, 36, 0.85) 25%, transparent 25%, transparent 75%, rgba(146, 51, 36, 0.85) 75%),
                linear-gradient(45deg, transparent 35%, rgba(69, 84, 77, 0.85) 35%, rgba(69, 84, 77, 0.85) 65%, transparent 65%)
              `,
              backgroundSize: "64px 32px, 64px 32px, 96px 42px",
              backgroundPosition: "0 0, 32px 0, 0 0",
            }}
          />
          <div
            className="h-24 w-full"
            style={{
              background:
                "linear-gradient(to bottom, rgba(236, 219, 191, 0.72) 0%, rgba(236, 219, 191, 0.42) 45%, rgba(236, 219, 191, 0) 100%)",
            }}
          />
        </div>
      )}

      <div className={cn(
        "relative z-20 mx-auto w-full max-w-2xl",
        compact ? "px-5 py-6" : "px-6 py-8 md:py-12"
      )}>
        {children}
      </div>
    </div>
  );
}
