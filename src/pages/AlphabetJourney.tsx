import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Volume2, VolumeX } from "lucide-react";
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
 * The page is set like a type specimen, because the letterforms are the whole
 * point of it. Each stage is one ruled panel — a hairline lattice of glyphs
 * with the stage's checkpoint as its bottom row — and there is not a single
 * pictorial icon on any of them. State is carried by ink instead: a mastered
 * letter sits at full weight, the current one takes the desert red with a
 * progress rule under it, and a locked one is ghosted but still legible,
 * because seeing the shape of what is coming is half the reason to show it.
 *
 * An earlier version dressed the stops up as little illustrated cards with
 * padlocks, ticks, trophies and flags in their corners. All four icons said
 * nothing the ink was not already saying, and together they made the one page
 * that introduces the writing system look like a sticker sheet.
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
              <span className="flex items-center gap-1.5 text-xs text-primary-foreground">
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
            <span
              dir="rtl"
              lang="ar"
              aria-hidden
              className="w-10 shrink-0 text-center font-arabic text-[34px] leading-none"
            >
              ٢٨
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-bold leading-tight">
                All 28 letters mastered
              </span>
              <span className="block text-xs text-primary-foreground">
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

              {/* One ruled panel per stage: gap-px over a border-coloured ground
                  draws the hairlines, and the checkpoint is the panel's own
                  bottom row rather than a separate card floating under it. */}
              <div className="grid grid-cols-4 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-7">
                {stage.letters.map((letter) => (
                  <LetterCell
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
                {/* Seven letters in a four-column lattice leave one cell open;
                    fill it so the ruled ground doesn't show through as a hole. */}
                <div aria-hidden className="bg-card sm:hidden" />

                <button
                  onClick={(e) => {
                    if (stageDone) {
                      tapFeedback(e.currentTarget);
                      navigate(`/alphabet/checkpoint/${checkpointIdx}`);
                    }
                  }}
                  disabled={!stageDone}
                  className={cn(
                    "relative col-span-4 flex items-center gap-3 bg-card px-4 py-3.5 text-left transition-colors sm:col-span-7",
                    stageDone && "active:bg-muted",
                  )}
                >
                  {stageDone && (
                    <span aria-hidden className="pointer-events-none absolute inset-0 bg-primary/10" />
                  )}
                  <span className="relative min-w-0 flex-1">
                    <span
                      className={cn(
                        "block text-sm font-medium",
                        !stageDone && "text-foreground/40",
                      )}
                    >
                      Checkpoint {stage.number}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {stageDone
                        ? `Quiz on letters ${stage.number * STAGE_SIZE - 6}–${stage.lastIndex + 1}`
                        : `Master all ${STAGE_SIZE} letters to open`}
                    </span>
                  </span>
                  {result ? (
                    <span className="relative shrink-0 text-xs font-semibold tabular-nums text-primary">
                      {result.score}%
                    </span>
                  ) : (
                    stageDone && (
                      <ChevronRight className="relative h-4 w-4 shrink-0 text-primary" />
                    )
                  )}
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </AppShell>
  );
};

interface LetterCellProps {
  letter: ArabicLetter;
  unlocked: boolean;
  mastered: boolean;
  steps: number;
  isCurrent: boolean;
  onOpen: (el: HTMLElement) => void;
}

/**
 * One glyph in the lattice. Three states only, because unlocking is
 * sequential: mastered (full ink), current (desert red, with the step rule
 * along its bottom edge), or locked (ghosted). No icons — the ink is the
 * state, and the small woven dot on a mastered cell is the only mark.
 */
const LetterCell = ({
  letter,
  unlocked,
  mastered,
  steps,
  isCurrent,
  onOpen,
}: LetterCellProps) => (
  <button
    onClick={(e) => {
      if (unlocked) onOpen(e.currentTarget);
    }}
    disabled={!unlocked}
    aria-label={`Letter ${letter.code}${unlocked ? "" : " (locked)"}`}
    className={cn(
      "relative flex aspect-square flex-col items-center justify-center gap-1.5 bg-card transition-colors",
      unlocked && "active:bg-muted",
    )}
  >
    {isCurrent && (
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-primary/10" />
    )}

    <span
      dir="rtl"
      lang="ar"
      aria-hidden
      className={cn(
        "relative font-arabic text-[30px] leading-none",
        mastered && "text-foreground",
        isCurrent && "text-primary",
        !unlocked && "text-foreground/25",
      )}
    >
      {letter.isolated}
    </span>
    <span
      className={cn(
        "relative max-w-full truncate px-1 text-[10px] leading-tight",
        unlocked ? "text-muted-foreground" : "text-foreground/25",
      )}
    >
      {letter.name_translit}
    </span>

    {mastered && (
      <span
        aria-hidden
        className="absolute right-2 top-2 h-1 w-1 rounded-full bg-primary/70"
      />
    )}

    {/* Step progress rides the bottom edge of the current cell. */}
    {isCurrent && steps > 0 && (
      <span className="absolute inset-x-0 bottom-0 h-1 bg-primary/15">
        <span
          className="block h-full bg-primary transition-[width] duration-500 ease-lahja motion-reduce:transition-none"
          style={{ width: `${Math.round((steps / 6) * 100)}%` }}
        />
      </span>
    )}
  </button>
);

export default AlphabetJourney;
