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
 *
 * From `lg` the same five slots stand up into a left rail. A full-width bar
 * pinned to the bottom of a 1280px window is a phone control on a desktop: it
 * puts the primary navigation as far from the content as the screen allows,
 * and wastes the one axis a wide window actually has. Same component, same
 * markup, same order — CSS decides which way it runs, so there is no
 * breakpoint flash and nothing to keep in sync.
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
        // Standing up into a left rail: bottom-anchored full-width bar below
        // lg, full-height 5rem column at and above it.
        "lg:inset-y-0 lg:right-auto lg:w-20 lg:border-r lg:border-t-0",
        "lg:top-[var(--rail-top)]",
        className,
      )}
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
        // Start the rail below the sadu band. The band runs edge to edge as
        // the app's signature; a rail painted over its first 5rem chops it and
        // reads as a rendering fault rather than as a deliberate surface.
        // Ignored below lg, where the dock is bottom-anchored and inset-y is
        // not in play.
        ["--rail-top" as string]: "var(--sadu-band-height)",
      }}
    >
      <ul
        className={cn(
          "mx-auto flex max-w-2xl items-stretch justify-around px-2",
          "lg:mx-0 lg:h-full lg:max-w-none lg:flex-col lg:justify-center lg:gap-1",
        )}
      >
        {SLOTS.map(({ to, label, icon: Icon, exact, primary, tourId, alsoOwns, badge }) => (
          <li key={to} className="flex-1 lg:flex-none" data-tour={tourId}>
            <NavLink
              to={to}
              end={exact}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors",
                  // The rail has room to be a real target rather than a strip.
                  "lg:gap-1 lg:rounded-xl lg:py-3 lg:text-[11px]",
                  isActive || alsoOwns?.test(pathname)
                    ? "text-foreground lg:bg-muted"
                    : "text-muted-foreground hover:text-foreground lg:hover:bg-muted/60",
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
