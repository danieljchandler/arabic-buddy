import { NavLink, useLocation } from "react-router-dom";
import { Home, LayoutGrid, Plus, MessageCircleQuestion, Gamepad2 } from "lucide-react";
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
 * This is the app's only bottom bar. It replaced a five-tab nav whose tabs
 * were places (Learn, Discover, Practice) rather than actions, which is why
 * three of them opened a list you then had to read. The colours here are
 * tokens rather than literals, because the same dock has to sit under a black
 * video on the feed and on the warm-sand pages everywhere else — the feed
 * wraps itself in `dark`, and the tokens flip with it.
 */

const SLOTS = [
  { to: "/", label: "Home", icon: Home, exact: true, tourId: "nav-feed" },
  { to: "/choose", label: "Skills", icon: LayoutGrid, tourId: "nav-choose" },
  { to: "/tutor-upload", label: "Upload", icon: Plus, primary: true, tourId: "nav-upload" },
  { to: "/how-do-i-say", label: "Ask", icon: MessageCircleQuestion, tourId: "nav-ask" },
  { to: "/vocab-games", label: "Games", icon: Gamepad2, tourId: "nav-games" },
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
        {SLOTS.map(({ to, label, icon: Icon, exact, primary, tourId }) => (
          <li key={to} className="flex-1" data-tour={tourId}>
            <NavLink
              to={to}
              end={exact}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
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
                <Icon className="h-5 w-5" />
              )}
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
