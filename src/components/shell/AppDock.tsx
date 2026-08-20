import { NavLink, useLocation } from "react-router-dom";
import { Home, LayoutGrid, Plus, MessageCircleQuestion, Layers } from "lucide-react";
import { useSRSStats } from "@/hooks/useSRSStats";
import { cn } from "@/lib/utils";

/**
 * Five slots, because five is what a thumb can hit.
 *
 * The options the app offers do not all fit here — seven-plus on a 390px
 * screen leaves 55px each, which takes an icon but crowds a label. So the four
 * skills live on the chooser (one tap away via Skills, or a sideways swipe)
 * and the dock carries the things you reach for mid-session.
 *
 * Profile is absent on purpose: it lives in the emblem, top-left, where it
 * never moves. That frees the fifth slot for something you actually use.
 *
 * Review holds one of those slots because spaced repetition is the other half
 * of this app: the video is what brings someone back, and the review queue is
 * what makes the watching add up to anything. It carries its due count, since
 * a review slot that cannot say whether there is work waiting is a slot you
 * learn to ignore. Games gave up the seat — it is a thing you choose to go and
 * do, so the chooser is the right place for it, and it is still there.
 *
 * This is the app's only bottom bar. It replaced a five-tab nav whose tabs
 * were places (Learn, Discover, Practice) rather than actions, which is why
 * three of them opened a list you then had to read. The colours here are
 * tokens rather than literals, because the same dock has to sit under a black
 * video on the feed and on the warm-sand pages everywhere else — the feed
 * wraps itself in `dark`, and the tokens flip with it.
 */

const SLOTS: {
  to: string;
  label: string;
  icon: typeof Home;
  exact?: boolean;
  primary?: boolean;
  tourId: string;
  /** Other routes this slot owns, so the dock still says where you are once
   *  you have gone one level in. */
  alsoOwns?: RegExp;
  /** Wears the count of cards waiting. Only Review has one to report. */
  badge?: boolean;
}[] = [
  { to: "/", label: "Home", icon: Home, exact: true, tourId: "nav-feed" },
  { to: "/choose", label: "Skills", icon: LayoutGrid, tourId: "nav-choose", alsoOwns: /^\/skills(\/|$)/ },
  { to: "/tutor-upload", label: "Upload", icon: Plus, primary: true, tourId: "nav-upload" },
  { to: "/review", label: "Review", icon: Layers, tourId: "nav-review", badge: true },
  { to: "/how-do-i-say", label: "Ask", icon: MessageCircleQuestion, tourId: "nav-ask" },
];

/**
 * Routes that take the whole screen: playback, review, quizzes, auth, admin.
 * A dock over a video is five taps waiting to be hit by mistake.
 */
const HIDE_PATTERNS: RegExp[] = [
  /^\/discover\/[^/]+/,
  /^\/review(\/|$)/,
  /^\/quiz(\/|$)/,
  /^\/stories\/[^/]+/,
  /^\/learn\/[^/]+/,
  /^\/battles\/[^/]+/,
  /^\/listen\/[^/]+/,
  /^\/alphabet\/[^/]+/,
  /^\/auth$/,
  /^\/onboarding$/,
  /^\/reset-password$/,
  /^\/admin(\/|$)/,
  /^\/set-phrases\/practice/,
  /^\/set-phrases\/review/,
  /^\/today\/story/,
];

export function shouldShowDock(pathname: string) {
  return !HIDE_PATTERNS.some((re) => re.test(pathname));
}

export function AppDock({ className }: { className?: string }) {
  const { pathname } = useLocation();
  // Cached for a minute and disabled when signed out, so this costs the dock
  // one query a session rather than one a page.
  const { data: srs } = useSRSStats();
  const due = srs?.totalDueNow ?? 0;

  if (!shouldShowDock(pathname)) return null;

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border",
        "bg-background/92 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        className,
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around px-2">
        {SLOTS.map(({ to, label, icon: Icon, exact, primary, tourId, alsoOwns, badge }) => (
          <li key={to} className="flex-1" data-tour={tourId}>
            <NavLink
              to={to}
              end={exact}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors",
                  isActive || alsoOwns?.test(pathname)
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              {primary ? (
                // The upload slot is a button, not a tab: it starts something
                // rather than going somewhere, and the shape says so.
                <span className="grid h-7 w-11 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <Icon className="h-5 w-5" strokeWidth={2.6} />
                </span>
              ) : (
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {badge && due > 0 && (
                    <span
                      aria-label={`${due} due`}
                      className={cn(
                        "absolute -right-2.5 -top-1 grid h-4 min-w-[1rem] place-items-center rounded-full px-1",
                        "bg-primary text-[10px] font-bold tabular-nums text-primary-foreground",
                      )}
                    >
                      {due > 99 ? "99+" : due}
                    </span>
                  )}
                </span>
              )}
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
