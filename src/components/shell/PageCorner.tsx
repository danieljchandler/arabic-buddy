import * as React from "react";
import { Home } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { shouldShowDock } from "@/components/shell/AppDock";
import { ProfileEmblem } from "@/components/shell/ProfileEmblem";
import { cn } from "@/lib/utils";

/**
 * The control in a page's top corner. Which control depends on the dock.
 *
 * This slot used to be a home button on every page that has one. Once the dock
 * arrived, that button pointed at "/" from forty pixels above a dock slot
 * pointing at "/" — the same destination twice, in the two most valuable spots
 * on the screen. So where the dock is showing, this becomes the profile
 * emblem instead, which is the thing the new navigation actually lacks: with
 * the old "Me" tab gone, there was otherwise no way to your account from any
 * of these pages.
 *
 * Where the dock is hidden — playback, review, quizzes, auth, admin — the home
 * button stays exactly as it was. Those are the routes with no other way out,
 * and swapping their only escape hatch for a profile link would strand people
 * mid-lesson.
 *
 * Reusing this slot rather than floating an emblem over the page is deliberate:
 * several pages put a control at the top corner already, so an overlay collides
 * with something whichever corner it picks. A slot the page itself reserved
 * cannot collide with the page.
 *
 * The emblem takes the *right* of that slot's row, never the left. The corner
 * on the left is the mark's everywhere else in the app, and an avatar sitting
 * in it on eighty interior pages was the whole complaint. `ml-auto` is what
 * does it, and it is chosen over a wrapper because this component is dropped
 * into two different shapes: a block on its own line, where an auto left
 * margin right-aligns a fixed-width box, and the first child of a flex row
 * that already has the page's own controls at its far end, where the same
 * margin eats the free space and parks the emblem beside them. Neither shape
 * had to be touched, and nothing the pages already place moved.
 *
 * The home button keeps the left. It is an escape hatch on routes with no
 * other way out, and the back-arrow corner is where a thumb looks for it.
 *
 * Some Radix/shadcn components pass refs to their children via `asChild`, so
 * this forwards refs.
 */
export const PageCorner = React.forwardRef<HTMLButtonElement, { className?: string }>(
  ({ className }, ref) => {
    const navigate = useNavigate();
    const { pathname } = useLocation();

    if (shouldShowDock(pathname)) {
      return <ProfileEmblem className={cn("ml-auto h-11 w-11", className)} />;
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
          "hover:bg-card hover:border-primary/20 active:scale-95",
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
