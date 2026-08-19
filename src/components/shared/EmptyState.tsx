import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import caughtUpArt from "@/assets/illustrations/empty-caught-up.webp";
import nothingArt from "@/assets/illustrations/empty-nothing.webp";

/**
 * What a screen says when it has nothing to show yet.
 *
 * Successor to the SaduBubble version, keeping its premise — the same brand
 * mark everywhere, saying the screen is waiting rather than broken — but the
 * mark is now painted artwork in the campfire-hero watercolor style. Two
 * pieces: "caught-up" is the reward state (a dallah pouring coffee under a
 * crescent — you're done), "nothing-yet" is the invitation state (an open
 * notebook and a finjan waiting on a sadu cushion — begin here). The image
 * rides a circular cream plate so the vignette's own background reads as
 * intentional on every surface, card or warm sand alike.
 */
const ART = {
  "caught-up": caughtUpArt,
  "nothing-yet": nothingArt,
} as const;

export interface EmptyStateProps {
  art?: keyof typeof ART;
  title: string;
  /** One line on how to make the emptiness go away. */
  body?: ReactNode;
  /** A way out — usually the button that starts the thing. */
  action?: ReactNode;
  /** Alternative to `action`: actions as children. */
  children?: ReactNode;
  className?: string;
  /** Plate diameter; md fits page-level empties, sm inline ones. */
  size?: "sm" | "md";
}

export function EmptyState({
  art = "nothing-yet",
  title,
  body,
  action,
  children,
  className,
  size = "md",
}: EmptyStateProps) {
  const actions = action ?? children;
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-4 text-center", className)}>
      <img
        src={ART[art]}
        alt=""
        aria-hidden
        loading="lazy"
        draggable={false}
        className={cn(
          "rounded-full object-cover bg-card-cream ring-1 ring-border/60 shadow-soft select-none mb-4 animate-scale-in",
          size === "md" ? "h-36 w-36" : "h-24 w-24",
        )}
      />
      <h2 className="font-heading text-lg font-bold text-foreground mb-1.5">{title}</h2>
      {body && <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">{body}</p>}
      {actions && (
        <div className="mt-5 flex w-full max-w-sm flex-col justify-center gap-3 sm:flex-row">{actions}</div>
      )}
    </div>
  );
}
