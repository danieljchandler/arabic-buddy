import { Link, useNavigate } from "react-router-dom";
import {
  Headphones, BookOpen, Mic, PenLine,
  Upload, MessageCircleQuestion, Gamepad2,
  BookA, Route as RouteIcon, ChevronRight, Layers, Clapperboard,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { BrandMark } from "@/components/shell/BrandMark";
import { SKILLS, VERBS, PATHS } from "@/lib/surfaces";
import { useSwipeSurfaces } from "@/hooks/useSwipeSurfaces";
import { useAlphabetProgress } from "@/hooks/useAlphabetProgress";
import { useSRSStats } from "@/hooks/useSRSStats";
import { ARABIC_LETTERS } from "@/data/arabicAlphabet";
import { cn } from "@/lib/utils";

/**
 * The chooser: four skills, three verbs, two paths.
 *
 * This replaces three hub screens carrying 44 entries between them. What made
 * those hard was not the count so much as the sameness — every row a rounded
 * card with an icon chip, so nothing said which one mattered. Here the four
 * skills are blocks you cannot mistake for each other, the verbs are visibly a
 * different kind of thing, and the long tail is not on screen at all.
 *
 * It keeps the app's warm-sand ground and Sadu border — this is a page, not a
 * video surface, so it wears the brand the way every other page does. Only the
 * feed goes dark, because only the feed is media.
 *
 * Reached by tapping Skills in the dock or by swiping the feed leftward.
 */

const ICONS = {
  Headphones, BookOpen, Mic, PenLine, Upload, MessageCircleQuestion, Gamepad2, BookA, Route: RouteIcon,
} as const;

const Choose = () => {
  const navigate = useNavigate();
  // The chooser sits one page forward of the feed, so getting back to it is a
  // backward swipe — rightward. That is onPrev, not onNext: wiring it to
  // onNext would send the same physical drag that opened this page to close
  // it again.
  const swipe = useSwipeSurfaces({ onPrev: () => navigate("/") });
  const { masteredCount } = useAlphabetProgress();
  const { data: srs } = useSRSStats();
  const due = srs?.totalDueNow ?? 0;

  return (
    <AppShell>
      <div {...swipe} className="flex min-h-[70dvh] flex-col gap-2.5">
        <header className="flex items-center justify-between gap-3">
          <BrandMark />
          {/* Two panes, this is the second: the dots say where you are, the
              title attribute says what the other pane is. A bare "← Video"
              label used to carry all of that alone, and read as a mystery. */}
          <div
            className="flex items-center gap-1.5"
            title="Swipe right for the clips feed"
            aria-hidden
          >
            <span className="h-1.5 w-1.5 rounded-full bg-foreground/25" />
            <span className="h-1.5 w-4 rounded-full bg-primary" />
          </div>
          {/* The emblem used to close this row; it lives in the dock's fifth
              slot now, so the header keeps just the way back. */}
          <Link to="/" className="text-xs text-muted-foreground">
            ← Watch clips
          </Link>
        </header>

        <h1 className="pb-1.5 pt-3 text-[28px] font-bold leading-tight">
          What do you want to do?
        </h1>

        {/* Review sits above the skills because on most days it is the answer.
            The four skills are what you do to learn something new; this is what
            makes the things you already met stick, and it is the half of the
            app that decays if it is skipped. It leads with the count, because
            "23 waiting" is a reason to tap and "Review" on its own is not. */}
        <Link
          to="/review"
          className={cn(
            "flex items-center gap-3.5 rounded-2xl bg-primary px-4 py-4 text-primary-foreground",
            "transition-transform active:scale-[0.99]",
          )}
        >
          <Layers className="h-6 w-6 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-bold leading-tight">Review</span>
            <span className="block text-xs text-primary-foreground">
              {due > 0
                ? `${due} ${due === 1 ? "card" : "cards"} ready now`
                : "Nothing due — you are caught up"}
            </span>
          </span>
          {due > 0 && (
            <span className="rounded-full bg-primary-foreground/20 px-3 py-1 text-base font-bold tabular-nums">
              {due}
            </span>
          )}
        </Link>

        {/* The four skills. Each one opens the skill, not a single activity
            inside it: sending "Read" straight to /reading is what left Souq
            News, the Reading Library and Stories with no door but the account
            page. Each skill's page is a full page, never a sheet — speaking
            needs a microphone and writing needs a keyboard, and both deserve
            the whole screen rather than half of it over a playing video. */}
        <div className="grid grid-cols-2 gap-2.5">
          {SKILLS.map((s, i) => {
            const Icon = ICONS[s.icon as keyof typeof ICONS];
            return (
              <Link
                key={s.id}
                to={s.to}
                className={cn(
                  "group relative flex aspect-[4/3.4] flex-col overflow-hidden rounded-2xl",
                  "border border-border bg-card shadow-topic",
                  "transition-all hover:shadow-topic-hover active:scale-[0.98]",
                )}
              >
                {/* The scene takes the top two thirds. The label never sits on
                    it: the art is a light watercolour and the label is ink, so
                    overlaying them is the one arrangement that cannot be made
                    to clear 4.5:1. It rides the cream plate below instead, and
                    the tint survives as the rule between the two. */}
                <span className="relative block h-[66%] overflow-hidden">
                  <img
                    src={s.art}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    draggable={false}
                    className={cn(
                      "h-full w-full select-none object-cover",
                      "transition-transform duration-500 group-hover:scale-[1.04]",
                    )}
                  />
                  {/* Index and icon ride one capsule rather than sitting
                      straight on the art. White with a drop-shadow was the
                      obvious thing and it failed: these scenes are pale
                      watercolour, so white-on-cream left the Read tile's icon
                      invisible and every numeral a smudge. A --card capsule
                      carrying the skill's own tint is legible over any of the
                      four, and flips with the theme for free. */}
                  <span
                    className={cn(
                      "absolute left-2.5 top-2.5 inline-flex items-center gap-1.5",
                      "rounded-full bg-card/85 px-2 py-1 backdrop-blur-sm",
                      "ring-1 ring-black/5",
                    )}
                    style={{ color: s.tint }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="text-[10px] font-bold tracking-[0.12em] tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </span>
                </span>
                <span aria-hidden className="h-[3px] w-full shrink-0" style={{ backgroundColor: s.tint }} />
                <span className="flex flex-1 flex-col justify-center gap-0.5 px-3.5">
                  <span className="font-heading text-xl font-bold leading-tight text-foreground">
                    {s.label}
                  </span>
                  <span dir="rtl" lang="ar" className="text-right font-arabic text-[13px] text-muted-foreground">
                    {s.arabic}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>

        {/* Verbs. Deliberately a different shape and size — these act on what
            you are already looking at, so they should not read as peers of a
            skill. */}
        <div className="grid grid-cols-3 gap-2.5">
          {VERBS.map((v) => {
            const Icon = ICONS[v.icon as keyof typeof ICONS];
            return (
              <Link
                key={v.id}
                to={v.to}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card py-3.5 transition-colors active:bg-muted"
              >
                <Icon className="h-5 w-5 text-primary" />
                <span className="text-xs font-medium">{v.label}</span>
              </Link>
            );
          })}
        </div>

        {/* The sequential paths. Where Ingleezy announces its curriculum as
            coming, both of Hakiya's are real — so the doors open, and the
            alphabet one reports its position, because a path is the one thing
            here that has one. */}
        <Link
          to="/alphabet"
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors active:bg-muted"
        >
          <BookA className="h-5 w-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Alphabet Journey</span>
            <span className="block text-[11px] text-muted-foreground">
              All 28 letters — trace, hear &amp; play
            </span>
            <span className="mt-1.5 block h-1 rounded-full bg-primary/15">
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${Math.round((masteredCount / ARABIC_LETTERS.length) * 100)}%` }}
              />
            </span>
          </span>
          <span className="text-xs font-semibold tabular-nums text-primary">
            {masteredCount}/{ARABIC_LETTERS.length}
          </span>
        </Link>
        <Link
          to="/curriculum"
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors active:bg-muted"
        >
          <RouteIcon className="h-5 w-5 shrink-0 text-primary" />
          <span className="flex-1">
            <span className="block text-sm font-medium">Curriculum</span>
            <span className="block text-[11px] text-muted-foreground">
              Lessons in order, stage by stage, progress saved
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link
          to="/clips"
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors active:bg-muted"
        >
          <Clapperboard className="h-5 w-5 shrink-0 text-primary" />
          <span className="flex-1">
            <span className="block text-sm font-medium">Word Clips</span>
            <span className="block text-[11px] text-muted-foreground">
              First words from real 5-second moments
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>
    </AppShell>
  );
};

export default Choose;
