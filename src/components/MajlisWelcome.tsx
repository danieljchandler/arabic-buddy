import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { useUserXP, useWeeklyGoal } from "@/hooks/useGamification";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { dialectAccent } from "@/lib/dialectAccent";
import { useIsInk } from "@/hooks/useBrandPreview";

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

/**
 * `display` is the same greeting set as display type for the Ink brand
 * preview — unvowelled, its kashida drawn out the way the voice draws it.
 * It is decoration over `ar`, which stays the version read aloud.
 */
function greetingFor(hour: number): { ar: string; en: string; display: string } {
  if (hour < 5) return { ar: "تصبح على خير", en: "Late night", display: "تصبـــح على خيـــر" };
  if (hour < 12) return { ar: "صَبَاحُ الخَيْر", en: "Good morning", display: "صبـــاح الخيـــر" };
  if (hour < 17) return { ar: "نَهَارَك سَعِيد", en: "Good afternoon", display: "نهـــارك سعيـــد" };
  if (hour < 22) return { ar: "مَسَاءُ الخَيْر", en: "Good evening", display: "مســـاء الخيـــر" };
  return { ar: "تصبح على خير", en: "Good night", display: "تصبـــح على خيـــر" };
}

export function MajlisWelcome() {
  const ink = useIsInk();
  const { user, isAuthenticated } = useAuth();
  const { activeDialect } = useDialect();
  const { data: weekly } = useWeeklyGoal();
  const { data: xp } = useUserXP();

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

  // The weekly row is written by a different path than the per-day XP counter
  // and can lag it — which put a weekly 0 beside a daily 20 on one screen, an
  // impossible state a learner can see. A week can never hold less than today.
  const todayUtc = new Date().toISOString().slice(0, 10);
  const xpToday = xp && xp.xp_today_date === todayUtc ? xp.xp_today : 0;
  const earned = Math.max(weekly?.earned_xp ?? 0, xpToday);
  // A zero target is a goal nobody set, not a tiny goal: useWeeklyGoal
  // synthesizes target_xp: 0 when the week has no row yet, so `?? 100` alone
  // never engaged and the goal-less ring rendered full against a target of 1.
  const target = (weekly?.target_xp ?? 0) > 0 ? weekly!.target_xp : 100;
  const pct = Math.min(100, Math.round((earned / target) * 100));

  // Ring math
  const R = 26;
  const C = 2 * Math.PI * R;
  const dash = (pct / 100) * C;

  const accent = dialectAccent(activeDialect);

  if (ink) {
    return (
      <InkWelcome
        greeting={greeting}
        name={isAuthenticated ? name : ""}
        dialect={activeDialect}
        streak={isAuthenticated ? streak?.current_streak ?? 0 : null}
        xp={isAuthenticated ? { earned, target, pct } : null}
      />
    );
  }

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
          <p className="mt-1 font-sans text-sm text-plum">
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
              <span className="font-heading text-[15px] font-bold text-plum">
                {compactXp(earned)}
              </span>
              {/* Named for its period: three XP figures share the home screen
                  (today's ring, total chip, this) and an unlabeled one reads
                  as a contradiction of the other two. */}
              <span className="text-[10px] uppercase tracking-wider text-plum mt-0.5">
                Week
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Ink brand preview ────────────────────────────────────────────────────
// Rendered instead of the panel above only while `?brand=ink` is on. The
// same facts — the greeting in the time of day's register, the dialect, the
// streak, the week's XP — set as the Ink-Today artboard sets them: an
// oxblood panel with the sadu pressed in, the Arabic in Rakkas with its
// kashida drawn out, the English in the serif, then a hairline band for the
// week. Full-bleed on a phone, as in the artboard; a plain panel from sm.

const DIALECT_ARABIC: Record<string, { initial: string; name: string }> = {
  Gulf: { initial: "خ", name: "خليجي" },
  Egyptian: { initial: "م", name: "مصري" },
  Yemeni: { initial: "ي", name: "يمني" },
};

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toArabicDigits = (n: number) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);

/** The streak's week of bars: heights only, the run decides which are lit. */
const WEEK_BARS = [50, 75, 62, 100, 70, 88, 56];

/** Ticks round the ring: 40 of them, a short stroke and a gap each. */
const RING_TICKS = 40;

function inkDateLabel(date: Date): string {
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
  const month = date.toLocaleDateString("en-GB", { month: "short" });
  return `${weekday} · ${String(date.getDate()).padStart(2, "0")} ${month}`;
}

function InkWelcome({
  greeting,
  name,
  dialect,
  streak,
  xp,
}: {
  greeting: { ar: string; en: string; display: string };
  name: string;
  dialect: string;
  /** null for a signed-out visitor: there is nothing to have a streak of. */
  streak: number | null;
  xp: { earned: number; target: number; pct: number } | null;
}) {
  const ar = DIALECT_ARABIC[dialect];
  const R = 26;
  const C = 2 * Math.PI * R;
  const tick = C / RING_TICKS;
  const lit = xp ? Math.round((xp.pct / 100) * RING_TICKS) : 0;
  const ticks = `1.6 ${(tick - 1.6).toFixed(3)}`;

  return (
    <div className="-mx-4 mb-4 sm:mx-0" data-ink-welcome="">
      <section
        data-ink-sadu=""
        className="bg-[#6B1F1F] px-5 pb-4 pt-3.5 text-[#EFE6CF] sm:rounded-[4px]"
      >
        <div className="ink-meta flex justify-between text-[#D5BEAC]">
          <span>Hikaya · Today</span>
          <span>{inkDateLabel(new Date())}</span>
        </div>
        <p
          aria-hidden="true"
          lang="ar"
          dir="rtl"
          className="font-ink-display pointer-events-none mt-1 text-right text-[44px] sm:text-[52px]"
        >
          {greeting.display}
        </p>
        <p lang="ar" dir="rtl" className="sr-only">
          {greeting.ar}
        </p>
        <p className="font-ink-serif text-[26px] leading-tight">
          {greeting.en}
          {name ? `, ${name}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-[#EFE6CF]/55 pl-[3px] pr-2.5 text-[12.5px] font-medium">
            {ar && (
              <span
                aria-hidden="true"
                lang="ar"
                className="grid h-5 w-5 place-items-center rounded-full bg-[#E2B65C] text-[11px] font-bold text-[#1A1C17]"
              >
                {ar.initial}
              </span>
            )}
            <span>{dialect}</span>
            {ar && (
              <>
                {" · "}
                <span lang="ar" dir="rtl">
                  {ar.name}
                </span>
              </>
            )}
          </span>
          {streak !== null && (
            <span className="inline-flex items-center gap-2.5" title={`${streak}-day streak`}>
              {/* A week of bars, one per day of the run, lit in mustard. */}
              <span aria-hidden="true" className="pointer-events-none flex h-4 items-end gap-[3px]">
                {WEEK_BARS.map((h, i) => (
                  <i
                    key={i}
                    data-lit={i < streak ? "" : undefined}
                    className={cn("block w-[3px]", i < streak ? "bg-[#E2B65C]" : "bg-[#EFE6CF]/30")}
                    style={{ height: `${h}%` }}
                  />
                ))}
              </span>
              <span className="text-[12.5px] font-medium">
                {streak} {streak === 1 ? "day" : "days"}
              </span>
              {/* The run in Arabic numerals too; a lone ٠ reads as a stray dot. */}
              {streak > 0 && (
                <span aria-hidden="true" lang="ar" className="font-ink-display text-xl text-[#E2B65C]">
                  {toArabicDigits(streak)}
                </span>
              )}
            </span>
          )}
        </div>
      </section>

      {xp && (
        <section
          className="flex items-center gap-4 border-b border-border px-5 py-3.5 sm:px-1"
          title={`${xp.earned} / ${xp.target} XP this week`}
        >
          <span className="relative h-16 w-16 shrink-0">
            <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden="true">
              <circle
                cx="32"
                cy="32"
                r={R}
                fill="none"
                strokeWidth="8"
                strokeDasharray={ticks}
                className="stroke-foreground/20"
              />
              <circle
                data-ink-ring=""
                cx="32"
                cy="32"
                r={R}
                fill="none"
                strokeWidth="8"
                strokeDasharray={lit > 0 ? `${Array(lit).fill(ticks).join(" ")} 0 ${C.toFixed(1)}` : `0 ${C.toFixed(1)}`}
                className="stroke-primary transition-[stroke-dasharray] duration-700 ease-out"
              />
            </svg>
            <span className="absolute inset-0 grid place-items-center text-[10px] font-semibold tracking-[0.1em]">
              XP
            </span>
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="ink-meta text-muted-foreground">Weekly XP</span>
            <span className="flex items-baseline gap-1.5">
              <span className="font-ink-serif text-[34px] leading-none text-primary">{compactXp(xp.earned)}</span>
              <span className="font-ink-serif text-[22px] leading-none">/ {xp.target}</span>
              <span className="text-[13px] text-muted-foreground">this week</span>
            </span>
          </span>
        </section>
      )}
    </div>
  );
}
