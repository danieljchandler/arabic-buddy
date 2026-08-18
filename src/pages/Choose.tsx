import { Link, useNavigate } from "react-router-dom";
import {
  Headphones, BookOpen, Mic, PenLine,
  Upload, MessageCircleQuestion, Gamepad2,
  BookA, Route as RouteIcon, ChevronRight,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ProfileEmblem } from "@/components/shell/ProfileEmblem";
import { SKILLS, VERBS, PATHS } from "@/lib/surfaces";
import { useSwipeSurfaces } from "@/hooks/useSwipeSurfaces";
import { useAlphabetProgress } from "@/hooks/useAlphabetProgress";
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

  return (
    <AppShell>
      <div {...swipe} className="flex min-h-[70dvh] flex-col gap-2.5">
        <header className="flex items-center justify-between">
          <ProfileEmblem />
          <div className="flex items-center gap-1.5" aria-hidden>
            <span className="h-1.5 w-1.5 rounded-full bg-foreground/25" />
            <span className="h-1.5 w-4 rounded-full bg-primary" />
          </div>
          <Link to="/" className="text-xs text-muted-foreground">
            ← Video
          </Link>
        </header>

        <h1 className="pb-1.5 pt-3 text-[28px] font-bold leading-tight">
          What do you want to do?
        </h1>

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
                style={{ backgroundColor: s.tint }}
                className={cn(
                  "relative flex aspect-[4/3.4] flex-col justify-between overflow-hidden rounded-2xl p-4 text-white",
                  "transition-transform active:scale-[0.98]",
                )}
              >
                <span className="text-[11px] font-semibold tracking-[0.14em] text-white/45">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <Icon className="absolute right-3 top-3 h-6 w-6 text-white/35" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-2xl font-bold leading-tight">{s.label}</span>
                  <span dir="rtl" lang="ar" className="text-right font-arabic text-[13px] text-white/60">
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
      </div>
    </AppShell>
  );
};

export default Choose;
