import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { useWeeklyGoal } from "@/hooks/useGamification";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { dialectAccent } from "@/lib/dialectAccent";

/**
 * A — Majlis welcome panel
 * Layered hero: Sadu watermark, time-of-day Arabic greeting, dialect chip,
 * streak flame, and weekly XP ring composed in one card.
 */

const DIALECT_GLYPH: Record<string, string> = {
  Gulf: "🌊",
  Egyptian: "🇪🇬",
  Yemeni: "🇾🇪",
};

/**
 * The XP total as it goes *inside* the ring.
 *
 * The ring is 64px across and the number sits in the ~47px hole in the middle,
 * so it holds four digits and no more. A learner on a 2,000 XP week would
 * otherwise push the figure out over the arc. The full number stays on the
 * title attribute either way.
 */
function compactXp(xp: number): string {
  if (xp < 1000) return String(xp);
  const thousands = xp / 1000;
  return `${thousands < 10 ? thousands.toFixed(1).replace(/\.0$/, "") : Math.round(thousands)}k`;
}

function greetingFor(hour: number): { ar: string; en: string } {
  if (hour < 5) return { ar: "تصبح على خير", en: "Late night" };
  if (hour < 12) return { ar: "صَبَاحُ الخَيْر", en: "Good morning" };
  if (hour < 17) return { ar: "نَهَارَك سَعِيد", en: "Good afternoon" };
  if (hour < 22) return { ar: "مَسَاءُ الخَيْر", en: "Good evening" };
  return { ar: "تصبح على خير", en: "Good night" };
}

export function MajlisWelcome() {
  const { user, isAuthenticated } = useAuth();
  const { activeDialect } = useDialect();
  const { data: weekly } = useWeeklyGoal();

  const { data: streak } = useQuery({
    queryKey: ["review-streak", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("review_streaks")
        .select("current_streak")
        .eq("user_id", user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const { data: profile } = useQuery({
    queryKey: ["profile-name", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const greeting = greetingFor(new Date().getHours());
  const name = profile?.display_name?.split(" ")[0] ?? user?.email?.split("@")[0] ?? "";

  const earned = weekly?.earned_xp ?? 0;
  const target = Math.max(weekly?.target_xp ?? 100, 1);
  const pct = Math.min(100, Math.round((earned / target) * 100));

  // Ring math
  const R = 26;
  const C = 2 * Math.PI * R;
  const dash = (pct / 100) * C;

  const accent = dialectAccent(activeDialect);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl mb-4",
        // Tokens, not the literal cream this was: on a near-black page a fixed
        // #F9F7F2 is the brightest thing in the app, and it sits at the top of
        // the most-visited screen.
        "bg-card-cream border border-plum/20",
        "px-4 py-4 sm:px-5 sm:py-5",
        "shadow-card"
      )}
    >
      {/* Sadu pattern watermark */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.55] pointer-events-none"
        style={{
          backgroundImage: "url(/assets/sadu-watermark.svg)",
          backgroundSize: "44px 44px",
          backgroundRepeat: "repeat",
        }}
      />
      {/* Warm radial highlight */}
      <div
        aria-hidden
        className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-desert-red/10 blur-3xl pointer-events-none"
      />

      <div className="relative flex items-start gap-4">
        {/* Left: greeting */}
        <div className="flex-1 min-w-0">
          <p
            className="text-2xl sm:text-3xl leading-tight text-plum font-arabic"
            dir="rtl"
          >
            {greeting.ar}
          </p>
          <p
            className="mt-1 text-sm text-plum"
            style={{ fontFamily: "'Open Sans', sans-serif" }}
          >
            {greeting.en}
            {isAuthenticated && name ? `, ${name}` : ""}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Dialect chip */}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full",
                "text-[11px] font-semibold border"
              )}
              style={{
                color: `hsl(${accent})`,
                backgroundColor: `hsl(${accent} / 0.12)`,
                borderColor: `hsl(${accent} / 0.35)`,
              }}
            >
              <span className="text-xs leading-none">{DIALECT_GLYPH[activeDialect] ?? "🗣️"}</span>
              {activeDialect}
            </span>

            {/* Streak flame */}
            {isAuthenticated && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 px-2.5 py-1 rounded-full",
                  "text-[11px] font-semibold border",
                  (streak?.current_streak ?? 0) > 0
                    ? "bg-desert-red/10 border-desert-red/40 text-desert-red"
                    : "bg-plum/5 border-plum/15 text-plum"
                )}
                title={`${streak?.current_streak ?? 0}-day streak`}
              >
                <Flame
                  className={cn(
                    "h-3 w-3",
                    (streak?.current_streak ?? 0) > 0 ? "text-desert-red" : "text-plum/40"
                  )}
                />
                {streak?.current_streak ?? 0}d
              </span>
            )}
          </div>
        </div>

        {/* Right: XP ring */}
        {isAuthenticated && (
          <div className="shrink-0 relative w-[64px] h-[64px]" title={`${earned} / ${target} XP this week`}>
            <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
              <circle
                cx="32"
                cy="32"
                r={R}
                stroke="hsl(var(--plum))"
                strokeOpacity={0.18}
                strokeWidth="5"
                fill="none"
              />
              <circle
                cx="32"
                cy="32"
                r={R}
                stroke="hsl(var(--plum))"
                strokeWidth="5"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${C}`}
                className="transition-[stroke-dasharray] duration-700 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
              <span
                className="text-[15px] font-bold text-plum"
                style={{ fontFamily: "'Montserrat', sans-serif" }}
              >
                {compactXp(earned)}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-plum mt-0.5">
                XP
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
