import { useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Routes, useLocation, type Location } from "react-router-dom";
import { useReducedMotion } from "@/lib/uiPrefs";

/**
 * TransitionRoutes — <Routes>, but route changes ride a view transition.
 *
 * Navigation used to be a hard cut: the old page vanished the frame the new
 * one mounted. This renders from its own copy of the location and only moves
 * that copy forward inside `document.startViewTransition`, so the browser
 * snapshots the outgoing page and cross-fades it into the incoming one. The
 * fixed chrome — the sadu border, the dock — is pixel-identical on both sides
 * of most navigations, so it reads as a stage that stays put while the
 * content changes. The animation itself lives in index.css on the
 * `::view-transition-*(root)` pseudo-elements, on the Lahja curve.
 *
 * `flushSync` is what the API requires, not an optimisation: the browser
 * captures the "new" state when the callback returns, so React has to have
 * committed by then. The React tree is small at the top (routes swap wholesale)
 * and navigations are user-paced, so the sync render is not a cost that shows.
 *
 * Falls back to an instant swap — exactly the old behaviour — when the
 * browser has no View Transitions API or the user prefers reduced motion.
 *
 * The transition's own promises are caught and ignored: a skipped or aborted
 * transition is the browser saying it swapped without animating, not a fault.
 */
export function TransitionRoutes({ children }: { children: ReactNode }) {
  const location = useLocation();
  const reduced = useReducedMotion();
  const [displayed, setDisplayed] = useState<Location>(location);

  useEffect(() => {
    if (location.key === displayed.key) return;
    if (reduced || typeof document.startViewTransition !== "function") {
      setDisplayed(location);
      return;
    }
    const transition = document.startViewTransition(() => {
      flushSync(() => setDisplayed(location));
    });
    // A transition the browser skips (hidden tab, reduced motion flipped
    // mid-flight) or aborts (a redirect landed before the cross-fade finished)
    // rejects these promises. The route has still changed — the swap happens
    // in the callback, which ran — so there is nothing to recover from, and
    // leaving them unhandled turns every such navigation into an
    // `unhandledrejection` the global crash handler used to toast about.
    const quiet = () => {};
    transition.ready.catch(quiet);
    transition.updateCallbackDone.catch(quiet);
    transition.finished.catch(quiet);
  }, [location, displayed.key, reduced]);

  return <Routes location={displayed}>{children}</Routes>;
}
