import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useIsInk } from "@/hooks/useBrandPreview";
import { SaduDiamond } from "@/components/brand/SaduDiamond";
import caughtUpArt from "@/assets/illustrations/empty-caught-up.webp";
import nothingArt from "@/assets/illustrations/empty-nothing.webp";
import noLessonsArt from "@/assets/illustrations/empty-no-lessons.webp";
import noRankingsArt from "@/assets/illustrations/empty-no-rankings.webp";
import noPhrasesArt from "@/assets/illustrations/empty-no-phrases.webp";
import noResultsArt from "@/assets/illustrations/empty-no-results.webp";

/**
 * What a screen says when it has nothing to show yet.
 *
 * Successor to the SaduBubble version, keeping its premise — the same brand
 * mark everywhere, saying the screen is waiting rather than broken — but the
 * mark is now painted artwork in the campfire-hero watercolor style. Two
 * pieces: "caught-up" is the reward state (a dallah pouring coffee under a
 * crescent — you're done), "nothing-yet" is the invitation state (an open
 * notebook and a finjan waiting on a sadu cushion — begin here). The image
 * rides a circular cream plate so the vignette's own background reads as
 * intentional on every surface, card or warm sand alike.
 *
 * Four more were added because two were doing the work of six: "nothing-yet"
 * alone answered no words, no lessons, no rankings and no saved phrases, so
 * four unrelated screens showed the identical picture and it stopped meaning
 * anything. Each new one names its own absence — an unlit lantern over blank
 * notebooks, an empty podium, an empty sadu speech bubble, a magnifier over a
 * blank page. Pick the one that matches what is missing; "nothing-yet" stays
 * the default for anything with no better fit.
 */
const ART = {
  "caught-up": caughtUpArt,
  "nothing-yet": nothingArt,
  /** No curriculum or lesson content for this dialect yet. */
  "no-lessons": noLessonsArt,
  /** Leaderboard with nobody on it. */
  "no-rankings": noRankingsArt,
  /** No saved phrases or set phrases. */
  "no-phrases": noPhrasesArt,
  /** A search or filter that matched nothing — distinct from never having
   *  started, which is "nothing-yet". */
  "no-results": noResultsArt,
} as const;

/**
 * The Ink brand preview has no illustrations, so under it each piece of art
 * becomes a letter: the first letter of a spoken word that names the
 * absence, set large in Rakkas on a paper plate. The word itself rides
 * underneath, small — the plate is a glyph, not a riddle.
 */
const INK_LETTER: Record<keyof typeof ART, { letter: string; word: string }> = {
  /** ممتاز — "excellent", said across the Gulf, Egypt and Yemen. Not خلاص:
   *  Rakkas draws dots as short dashes, so a lone خ on the plate read as غ. */
  "caught-up": { letter: "م", word: "ممتاز" },
  /** حكاية — every story starts somewhere. */
  "nothing-yet": { letter: "ح", word: "حكاية" },
  /** درس — a lesson. */
  "no-lessons": { letter: "د", word: "درس" },
  /** سباق — a race nobody has run yet. */
  "no-rankings": { letter: "س", word: "سباق" },
  /** كلام — talk, what a saved phrase is. */
  "no-phrases": { letter: "ك", word: "كلام" },
  /** بحث — a search. */
  "no-results": { letter: "ب", word: "بحث" },
};

export interface EmptyStateProps {
  art?: keyof typeof ART;
  title: string;
  /** One line on how to make the emptiness go away. */
  body?: ReactNode;
  /** A way out — usually the button that starts the thing. */
  action?: ReactNode;
  /** Alternative to `action`: actions as children. */
  children?: ReactNode;
  className?: string;
  /** Plate diameter; md fits page-level empties, sm inline ones. */
  size?: "sm" | "md";
}

export function EmptyState({
  art = "nothing-yet",
  title,
  body,
  action,
  children,
  className,
  size = "md",
}: EmptyStateProps) {
  const actions = action ?? children;
  const ink = useIsInk();
  const glyph = INK_LETTER[art];
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-4 text-center", className)}>
      {ink ? (
        <span
          aria-hidden="true"
          data-ink-plate={art}
          className={cn(
            "pointer-events-none relative mb-4 grid place-items-center overflow-hidden rounded-[4px] bg-muted text-primary",
            size === "md" ? "h-36 w-36" : "h-24 w-24",
          )}
        >
          <SaduDiamond size={size === "md" ? 10 : 8} className="absolute left-2.5 top-2.5" />
          <span
            lang="ar"
            className={cn("font-ink-display leading-none", size === "md" ? "-mt-6 text-[88px]" : "-mt-4 text-[56px]")}
          >
            {glyph.letter}
          </span>
          <span
            lang="ar"
            dir="rtl"
            className={cn(
              "absolute inset-x-0 bottom-1.5 text-center leading-none text-muted-foreground",
              size === "md" ? "text-xs" : "text-[10px]",
            )}
          >
            {glyph.word}
          </span>
        </span>
      ) : (
        <img
          src={ART[art]}
          alt=""
          aria-hidden
          loading="lazy"
          draggable={false}
          className={cn(
            "rounded-full object-cover bg-card-cream ring-1 ring-border/60 shadow-soft select-none mb-4 animate-scale-in",
            size === "md" ? "h-36 w-36" : "h-24 w-24",
          )}
        />
      )}
      <h2 className="font-heading text-lg font-bold text-foreground mb-1.5">{title}</h2>
      {body && <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">{body}</p>}
      {actions && (
        <div className="mt-5 flex w-full max-w-sm flex-col justify-center gap-3 sm:flex-row">{actions}</div>
      )}
    </div>
  );
}
