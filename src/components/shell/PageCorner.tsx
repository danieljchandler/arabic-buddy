import * as React from "react";
import { Home } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDockVisible } from "@/components/shell/AppDock";
import { cn } from "@/lib/utils";

/**
 * The control in a page's top corner — and, where the dock is showing,
 * nothing at all.
 *
 * This slot used to be a home button on every page that has one, then the
 * profile emblem once the dock made a corner home button redundant. The
 * emblem has since moved again, into the dock's own fifth slot, where every
 * feed app this audience uses keeps it — which makes an emblem up here the
 * same duplication the home button was: the identical destination twice, in
 * the two most valuable spots on the screen. So on dock pages the corner
 * yields entirely and the page keeps the room.
 *
 * Where the dock is hidden — playback, review, quizzes, auth, admin, and any
 * page seen by a visitor who is not signed in — the home button stays exactly
 * as it was. Those are the places with no other way out, and taking away their
 * only escape hatch would strand people mid-lesson.
 *
 * Some Radix/shadcn components pass refs to their children via `asChild`, so
 * this forwards refs.
 */
export const PageCorner = React.forwardRef<HTMLButtonElement, { className?: string }>(
  ({ className }, ref) => {
    const navigate = useNavigate();
    const dockVisible = useDockVisible();

    if (dockVisible) {
      return null;
    }

    return (
      <button
        ref={ref}
        onClick={() => navigate("/")}
        className={cn(
          "w-11 h-11 rounded-xl",
          "flex items-center justify-center",
          "bg-card/80 border border-border",
          "transition-all duration-200",
          "hover:bg-card hover:border-primary/20 active:scale-[0.98]",
          "focus:outline-none focus:ring-2 focus:ring-primary/30",
          className,
        )}
        aria-label="Go home"
        type="button"
      >
        <Home className="w-5 h-5 text-muted-foreground" />
      </button>
    );
  },
);
PageCorner.displayName = "PageCorner";
