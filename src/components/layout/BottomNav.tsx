import { NavLink, useLocation } from "react-router-dom";
import { Sparkles, GraduationCap, Play, Brain, User } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "Today", icon: Sparkles, match: (p: string) => p === "/" },
  { to: "/learn-hub", label: "Learn", icon: GraduationCap, match: (p: string) => p.startsWith("/learn-hub") },
  { to: "/discover", label: "Discover", icon: Play, match: (p: string) => p === "/discover" },
  { to: "/practice", label: "Practice", icon: Brain, match: (p: string) => p.startsWith("/practice") },
  { to: "/me", label: "Me", icon: User, match: (p: string) => p.startsWith("/me") },
];

/**
 * Routes where the bottom nav should be hidden so focused flows stay
 * edge-to-edge (video playback, review, quiz, auth, etc.).
 */
const HIDE_PATTERNS: RegExp[] = [
  /^\/discover\/[^/]+/,
  /^\/review(\/|$)/,
  /^\/quiz\//,
  /^\/stories\/[^/]+/,
  /^\/learn\/[^/]+/,
  /^\/battles\/[^/]+/,
  /^\/listen\/[^/]+/,
  /^\/alphabet\/[^/]+/,
  /^\/auth$/,
  /^\/onboarding$/,
  /^\/reset-password$/,
  /^\/admin(\/|$)/,
  /^\/quiz$/,
  /^\/set-phrases\/practice/,
  /^\/set-phrases\/review/,
  /^\/today\/story/,
];

export function shouldShowBottomNav(pathname: string) {
  return !HIDE_PATTERNS.some((re) => re.test(pathname));
}

export function BottomNav() {
  const { pathname } = useLocation();
  if (!shouldShowBottomNav(pathname)) return null;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-[#5C3A46]/20 bg-[#F9F7F2]/95 backdrop-blur supports-[backdrop-filter]:bg-[#F9F7F2]/80"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around">
        {TABS.map(({ to, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-[11px] font-medium transition-colors",
                  active ? "text-[#5C3A46]" : "text-[#5C3A46]/55 hover:text-[#5C3A46]/80",
                )}
              >
                <Icon className={cn("h-5 w-5", active && "scale-110")} strokeWidth={active ? 2.4 : 2} />
                <span>{label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
