import { Link, useNavigate } from "react-router-dom";
import { Lock, Check, Flag, Trophy, ChevronRight, Volume2, VolumeX } from "lucide-react";
import { ARABIC_LETTERS, CHECKPOINT_INDICES, type ArabicLetter } from "@/data/arabicAlphabet";
import { useAlphabetProgress, useCheckpointProgress } from "@/hooks/useAlphabetProgress";
import { AppShell } from "@/components/layout/AppShell";
import { ProfileEmblem } from "@/components/shell/ProfileEmblem";
import { MilestoneBanner } from "@/components/alphabet/MilestoneBanner";
import { tapFeedback } from "@/lib/tapFeedback";
import { useSoundPref } from "@/lib/uiPrefs";
import { cn } from "@/lib/utils";

/**
 * The alphabet path: 28 letters in four stages, each stage closed by a quiz.
 *
 * This was a cartoon before — a fixed desert scene with a sun, drifting clouds,
 * palm trees and an oasis, painted over the top of the app's own Sadu ground,
 * with a camel bobbing along a dashed trail of zigzagging gold discs. None of
 * its colours were brand colours and none of its motion was in the app's motion
 * language, so the one page meant to introduce the writing system was the one
 * page that looked like a different product.
 *
 * What replaced it is the chooser's vocabulary, because that is what a learner
 * has just come from: bordered cards on the shared warm-sand ground, semantic
 * tokens throughout, and the four Lahja motions and nothing else. The zigzag
 * became a grid — 28 stops read faster side by side than stacked down a column,
 * and the four stages are the structure the checkpoints already implied.
 */

/** Letters per stage — CHECKPOINT_INDICES sits at the end of each block of 7. */
const STAGE_SIZE = 7;

const AlphabetJourney = () => {
  const navigate = useNavigate();
  const { progress, isUnlocked, masteredCount } = useAlphabetProgress();
  const { checkpoints } = useCheckpointProgress();
  const [soundOn, setSoundOn] = useSoundPref();

  // The frontier: the first unlocked letter still unfinished. Unlocking is
  // sequential, so there is only ever one, and it is the only thing on the page
  // the learner actually has to decide to tap.
  const currentIndex = ARABIC_LETTERS.findIndex(
    (l) => isUnlocked(l.order_index) && !progress[l.code]?.mastered_at,
  );
  const current = currentIndex >= 0 ? ARABIC_LETTERS[currentIndex] : null;
  const currentSteps = current
    ? (progress[current.code]?.steps_completed?.length ?? 0)
    : 0;

  const pct = Math.round((masteredCount / ARABIC_LETTERS.length) * 100);

  const stages = CHECKPOINT_INDICES.map((lastIndex, i) => ({
    number: i + 1,
    lastIndex,
    letters: ARABIC_LETTERS.slice(i * STAGE_SIZE, lastIndex + 1),
  }));

  return (
    <AppShell>
      <div className="flex flex-col gap-2.5">
        <header className="flex items-center justify-between">
          <ProfileEmblem />
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSoundOn(!soundOn)}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label={soundOn ? "Mute chimes" : "Unmute chimes"}
            >
              {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <Link to="/choose" className="text-xs text-muted-foreground">
              ← Skills
            </Link>
          </div>
        </header>

        <h1 className="pt-3 text-[28px] font-bold leading-tight">Alphabet Journey</h1>
        <p className="text-sm text-muted-foreground">
          All 28 letters in order. Each one is a short lesson — meet it, hear it,
          trace it, then play.
        </p>

        {/* Overall progress. The bar carries the shape of the thing and the
            count carries the number; neither reads well doing both jobs. */}
        <div className="flex items-center gap-3 pb-2 pt-1">
          <span className="h-1.5 flex-1 rounded-full bg-primary/15">
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-500 ease-lahja motion-reduce:transition-none"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
            {masteredCount} / 28 mastered
          </span>
        </div>

        <MilestoneBanner masteredCount={masteredCount} />

        {/* One call to action, leading with the letter itself. "Continue" on its
            own is not a reason to tap; the glyph you are three steps into is. */}
        {current ? (
          <Link
            to={`/alphabet/${current.code}`}
            className={cn(
              "flex items-center gap-3.5 rounded-2xl bg-primary px-4 py-4 text-primary-foreground",
              "transition-transform active:scale-[0.99]",
            )}
          >
            <span
              dir="rtl"
              lang="ar"
              aria-hidden
              className="w-10 shrink-0 text-center font-arabic text-[34px] leading-none"
            >
              {current.isolated}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-bold leading-tight">
                {currentSteps > 0 ? "Continue" : "Start"} {current.name_translit}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-primary-foreground/80">
                <span>Stop {currentIndex + 1} of 28</span>
                {currentSteps > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">{currentSteps}/6 steps</span>
                  </>
                )}
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-primary-foreground/70" />
          </Link>
        ) : (
          <div className="flex items-center gap-3.5 rounded-2xl bg-primary px-4 py-4 text-primary-foreground">
            <Trophy className="h-6 w-6 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-bold leading-tight">
                All 28 letters mastered
              </span>
              <span className="block text-xs text-primary-foreground/80">
                Every stage is complete.
              </span>
            </span>
          </div>
        )}

        {stages.map((stage) => {
          const checkpointIdx = stage.number - 1;
          const stageDone = !!progress[ARABIC_LETTERS[stage.lastIndex].code]?.mastered_at;
          const result = checkpoints[checkpointIdx];

          return (
            <section key={stage.number} className="pt-5">
              <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Stage {stage.number} · Letters {stage.number * STAGE_SIZE - 6}–
                {stage.lastIndex + 1}
              </h2>

              <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-7">
                {stage.letters.map((letter) => (
                  <LetterTile
                    key={letter.code}
                    letter={letter}
                    unlocked={isUnlocked(letter.order_index)}
                    mastered={!!progress[letter.code]?.mastered_at}
                    steps={progress[letter.code]?.steps_completed?.length ?? 0}
                    isCurrent={letter.order_index === currentIndex}
                    onOpen={(el) => {
                      tapFeedback(el);
                      navigate(`/alphabet/${letter.code}`);
                    }}
                  />
                ))}
              </div>

              {/* The checkpoint belongs to the stage above it, so it sits inside
                  the section rather than floating between two of them. */}
              <button
                onClick={(e) => {
                  if (stageDone) {
                    tapFeedback(e.currentTarget);
                    navigate(`/alphabet/checkpoint/${checkpointIdx}`);
                  }
                }}
                disabled={!stageDone}
                className={cn(
                  "mt-2.5 flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors",
                  stageDone
                    ? "border-primary bg-primary/10 active:bg-primary/15"
                    : "border-border bg-card opacity-55",
                )}
              >
                {result ? (
                  <Trophy className="h-5 w-5 shrink-0 text-primary" />
                ) : stageDone ? (
                  <Flag className="h-5 w-5 shrink-0 text-primary" />
                ) : (
                  <Lock className="h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    Checkpoint {stage.number}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {stageDone
                      ? `Quiz on letters ${stage.number * STAGE_SIZE - 6}–${stage.lastIndex + 1}`
                      : `Master all ${STAGE_SIZE} letters to open`}
                  </span>
                </span>
                {result && (
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-primary">
                    {result.score}%
                  </span>
                )}
              </button>
            </section>
          );
        })}
      </div>
    </AppShell>
  );
};

interface LetterTileProps {
  letter: ArabicLetter;
  unlocked: boolean;
  mastered: boolean;
  steps: number;
  isCurrent: boolean;
  onOpen: (el: HTMLElement) => void;
}

/**
 * One stop. Three states only, because unlocking is sequential: mastered,
 * current, or locked — there is no "open but not started" that is not current.
 */
const LetterTile = ({
  letter,
  unlocked,
  mastered,
  steps,
  isCurrent,
  onOpen,
}: LetterTileProps) => (
  <button
    onClick={(e) => {
      if (unlocked) onOpen(e.currentTarget);
    }}
    disabled={!unlocked}
    aria-label={`Letter ${letter.code}${unlocked ? "" : " (locked)"}`}
    className={cn(
      "relative flex aspect-square flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border transition-colors",
      mastered && "border-primary/35 bg-primary/5 active:bg-primary/10",
      isCurrent && "border-primary bg-primary/10 active:bg-primary/15",
      // Locked stops stay legible rather than greyed to nothing: seeing the
      // shape of what is coming is half the reason to show them at all.
      !unlocked && "border-border bg-card opacity-70",
    )}
  >
    <span
      dir="rtl"
      lang="ar"
      aria-hidden
      className={cn(
        "font-arabic text-2xl leading-none",
        unlocked ? "text-primary" : "text-muted-foreground",
      )}
    >
      {letter.isolated}
    </span>
    <span
      className={cn(
        "max-w-full truncate px-1 text-[10px] leading-tight",
        unlocked ? "text-muted-foreground" : "text-muted-foreground/70",
      )}
    >
      {letter.name_translit}
    </span>

    {mastered && (
      <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground animate-scale-in motion-reduce:animate-none">
        <Check className="h-2.5 w-2.5" />
      </span>
    )}

    {!unlocked && (
      <Lock className="absolute right-1 top-1 h-3 w-3 text-muted-foreground" />
    )}

    {/* Step progress rides the bottom edge of the tile rather than ringing it —
        a square with a circular gauge around it was the old trail's idea. */}
    {isCurrent && steps > 0 && (
      <span className="absolute inset-x-0 bottom-0 h-1.5 bg-primary/15">
        <span
          className="block h-full bg-primary transition-[width] duration-500 ease-lahja motion-reduce:transition-none"
          style={{ width: `${Math.round((steps / 6) * 100)}%` }}
        />
      </span>
    )}
  </button>
);

export default AlphabetJourney;
