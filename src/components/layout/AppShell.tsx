import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SaduBanner } from "@/components/design-system/SaduBanner";
import shapesOverlayImg from "@/assets/shapes-overlay.png";

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
        backgroundImage: `url(${shapesOverlayImg})`,
        backgroundSize: "cover",
        backgroundPosition: "top center",
        backgroundRepeat: "no-repeat",
        backgroundAttachment: "fixed",
      }}
    >
      <SaduBanner />
      <div className={cn(
        "relative mx-auto w-full max-w-2xl",
        compact ? "px-5 py-6" : "px-6 pt-4 pb-8 md:pt-6 md:pb-12"
      )}>
        {children}
      </div>
    </div>
  );
}
