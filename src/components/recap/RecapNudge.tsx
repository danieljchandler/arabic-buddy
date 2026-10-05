import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, History, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRecapSummary } from "@/hooks/useRecap";
import { isAssistantOffRoute } from "@/lib/assistantRoutes";
import {
  dismissRecapNudge,
  isRecapNudgeDismissed,
  RECAP_PATH,
  RECAP_TASK_ID,
  recapTitle,
  shouldShowRecapNudge,
} from "@/lib/recap";
import { isTaskCompletedToday } from "@/lib/todayCompletion";
import { shouldShowDock } from "@/components/shell/AppDock";
import { cn } from "@/lib/utils";

/**
 * The strip at the bottom of the screen that offers the day's recap.
 *
 * Mounted once at the app root beside the Ask AI disc, for the same reason
 * the disc is: a handful of screens render their own layout instead of
 * AppShell, and the shell's content column is animated, which makes it a
 * containing block for fixed children (see e2e/shell-fixed-positioning).
 * Mounted here it anchors to the viewport on every page.
 *
 * Where it sits: above the dock and the two floating buttons until `lg`,
 * centred, so a thumb reaching for Ask AI or the feedback disc never lands on
 * it; from `lg` it drops to the bottom edge between them. It shows for a
 * signed-in learner on routes where chrome belongs — not over a video, a
 * review session, a sign-in form or the recap itself — once the summary has
 * said there is something to go over, and goes away for the day when the
 * learner either does the recap or waves it off.
 *
 * It fetches once per local day: the summary is cached for the day and the
 * query is off on the routes it would never show on.
 */
export function RecapNudge({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const { isAuthenticated } = useAuth();
  const routeAllowed =
    !isAssistantOffRoute(pathname) && shouldShowDock(pathname) && !pathname.startsWith(RECAP_PATH);
  const { data: summary } = useRecapSummary({ enabled: isAuthenticated && routeAllowed });
  const [dismissed, setDismissed] = useState(false);
  const [completedToday, setCompletedToday] = useState(() => isTaskCompletedToday(RECAP_TASK_ID));

  // The per-day flags live in localStorage; re-read them when the day's
  // summary arrives and whenever the Today queue changes.
  useEffect(() => {
    if (summary) setDismissed(isRecapNudgeDismissed(summary.date));
  }, [summary]);
  useEffect(() => {
    const refresh = () => setCompletedToday(isTaskCompletedToday(RECAP_TASK_ID));
    window.addEventListener("today:tasks-changed", refresh);
    return () => window.removeEventListener("today:tasks-changed", refresh);
  }, []);

  if (!shouldShowRecapNudge({ routeAllowed, isAuthenticated, summary, dismissed, completedToday })) return null;
  const ready = summary!;

  const dismiss = () => {
    dismissRecapNudge(ready.date);
    setDismissed(true);
  };

  return (
    <aside
      aria-label={recapTitle(ready.windowDays)}
      data-testid="recap-nudge"
      data-feedback-ignore="true"
      className={cn(
        // Above the dock (bottom-0 until lg) and the two floating discs that
        // sit at bottom-20 — z-[45] keeps it under the discs and the modal
        // layer, over page content and the dock.
        // Centred with auto margins rather than a translate: the arrival
        // animation owns `transform`, and would have won the fight for it.
        "fixed inset-x-3 z-[45] mx-auto max-w-md",
        "bottom-[8.75rem] lg:bottom-6 lg:w-[26rem]",
        "flex items-center gap-3 rounded-2xl border border-border bg-card p-3 text-card-foreground shadow-lg",
        "motion-safe:animate-fade-up",
        className,
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <History className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{ready.headline}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {ready.firstVideo ? `Go over "${ready.firstVideo}" and your words with the tutor` : "Go over it with the tutor in five minutes"}
        </span>
      </span>
      {/* A literal path rather than RECAP_PATH: the reachability guard reads
          links off the source, and this is the recap's way in. */}
      <Link
        to="/recap"
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-transform hover:scale-[1.03] active:scale-95"
      >
        Recap
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Not now"
        className="-mr-1 shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </aside>
  );
}
