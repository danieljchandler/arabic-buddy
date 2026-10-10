import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Timer, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { QuizItem } from "@/components/review/QuizCardFrame";
import { QuizChoiceCard } from "@/components/review/QuizChoiceCard";
import { ReviewClozeCard } from "@/components/review/ReviewClozeCard";
import { sentenceHasWord } from "@/lib/arabicWord";
import {
  LIGHTNING_MS,
  LIGHTNING_REVEAL_MS,
  LIGHTNING_SECONDS,
  answerLightning,
  canOfferLightning,
  currentLightningId,
  expireLightning,
  lightningRemainingMs,
  lightningResult,
  nextLightning,
  startLightning,
  type LightningState,
  type LightningWord,
} from "@/lib/lightningRound";
import { cn } from "@/lib/utils";

interface LightningRoundProps {
  /** The session's right answers at steps 1–4, each with the question the round asks it. */
  words: ReadonlyArray<LightningWord<QuizItem>>;
  /** The wider deck, for wrong options; the round's own words are added to it. */
  pool: ReadonlyArray<{ arabic: string; english: string }>;
}

/** How often the clock is read while the round runs. */
const TICK_MS = 200;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * The lightning round (quiz Phase 7), offered on a quiz deck's end screen:
 * sixty seconds over the words the learner got right in the session at the
 * ladder's first four steps, asked again one after another, each moving on by
 * itself. Score and time, and nothing else (`src/lib/lightningRound.ts`).
 *
 * It reuses the session's own question cards, bare: nothing is synthesised or
 * played by itself, and there is no tutor, translation or hint to open. No
 * answer here is a rating, nothing is written, and no XP is paid.
 */
export const LightningRound = ({ words, pool }: LightningRoundProps) => {
  const [round, setRound] = useState<{ n: number; state: LightningState } | null>(null);
  const [lastRight, setLastRight] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const containerRef = useRef<HTMLDivElement | null>(null);

  const byId = useMemo(() => new Map(words.map((word) => [word.id, word])), [words]);

  // Wrong options: the wider deck and the round's own words, each once.
  const arabicPool = useMemo(
    () => [...new Set([...pool.map((p) => p.arabic), ...words.map((w) => w.item.arabic)])],
    [pool, words],
  );
  const englishPool = useMemo(
    () => [...new Set([...pool.map((p) => p.english), ...words.map((w) => w.item.english)])],
    [pool, words],
  );

  const running = round !== null && round.state.endedAt === null;

  // The clock, read a few times a second while the round runs: it ends the
  // round on the minute whatever is on screen.
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setRound((r) => (r ? { ...r, state: expireLightning(r.state, t) } : r));
    }, TICK_MS);
    return () => clearInterval(tick);
  }, [running, round?.n]);

  // An answer stays on screen for a beat, then the next word.
  const revealing = round?.state.revealing ?? false;
  const index = round?.state.index ?? 0;
  useEffect(() => {
    if (!revealing) return;
    const beat = setTimeout(
      () => setRound((r) => (r ? { ...r, state: nextLightning(r.state, Date.now()) } : r)),
      lastRight ? LIGHTNING_REVEAL_MS.right : LIGHTNING_REVEAL_MS.wrong,
    );
    return () => clearTimeout(beat);
  }, [revealing, index, lastRight]);

  if (!canOfferLightning(words)) return null;

  const start = () => {
    const t = Date.now();
    setNow(t);
    setRound((r) => ({ n: (r?.n ?? 0) + 1, state: startLightning([...byId.keys()], `${r?.n ?? 0}`, t) }));
    containerRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  const answer = (correct: boolean) => {
    setLastRight(correct);
    setRound((r) => (r ? { ...r, state: answerLightning(r.state, correct, Date.now()) } : r));
  };

  // Before the first round: the offer.
  if (!round) {
    return (
      <div ref={containerRef} className="mb-8 rounded-2xl border border-primary/25 bg-primary/5 p-5 text-center">
        <Zap className="h-6 w-6 text-primary mx-auto mb-2" aria-hidden />
        <h2 className="text-base font-semibold text-foreground">Lightning round</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          {LIGHTNING_SECONDS} seconds over the {plural(words.length, "word")} you got right. Score and time only —
          nothing in it is rated.
        </p>
        <Button onClick={start} className="gap-2">
          <Zap className="h-4 w-4" />
          Start
        </Button>
      </div>
    );
  }

  const result = lightningResult(round.state);
  if (result) {
    return (
      <div ref={containerRef} className="mb-8 rounded-2xl border border-border bg-card p-5 text-center">
        <Zap className="h-6 w-6 text-primary mx-auto mb-2" aria-hidden />
        <h2 className="text-base font-semibold text-foreground">
          {result.cleared ? `Every word in ${result.seconds} s` : "Time!"}
        </h2>
        <p className="text-3xl font-bold text-foreground tabular-nums my-2" aria-label="Lightning round score">
          {result.right} / {result.total}
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          {plural(result.right, "right answer")}
          {result.cleared ? "" : ` of ${result.answered} asked`} · {result.seconds} s
        </p>
        <Button variant="outline" onClick={start} className="gap-2">
          <RotateCcw className="h-4 w-4" />
          Play again
        </Button>
      </div>
    );
  }

  const id = currentLightningId(round.state);
  const word = id ? byId.get(id) : undefined;
  const remaining = lightningRemainingMs(round.state, now);
  const seconds = Math.ceil(remaining / 1000);
  const key = `${round.n}:${round.state.index}`;
  // A gap needs the word in its sentence, as it was in the session; a card
  // without one is asked its meaning rather than left with nothing to answer.
  const sentence = word?.format === "cloze" ? word.item.sentence : null;
  const gap = sentence && sentenceHasWord(sentence.arabic, word!.item.arabic) ? sentence : null;

  return (
    <div ref={containerRef} className="mb-8 text-left" data-testid="lightning-round">
      <div className="flex items-center justify-between gap-3 mb-2 text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground tabular-nums">
          <Timer className="h-4 w-4 text-primary" aria-hidden />
          <span aria-label={`${seconds} seconds left`}>{seconds} s</span>
        </span>
        <span className="text-muted-foreground tabular-nums">
          {round.state.index + 1} / {round.state.order.length}
        </span>
        <span className="font-semibold text-foreground tabular-nums" aria-live="polite">
          {plural(round.state.right, "right")}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-4" aria-hidden>
        <div
          className={cn("h-full bg-primary transition-[width] duration-200 ease-linear", seconds <= 10 && "bg-amber-500")}
          style={{ width: `${(remaining / LIGHTNING_MS) * 100}%` }}
        />
      </div>

      {word && gap ? (
        <ReviewClozeCard
          key={key}
          wordArabic={word.item.arabic}
          wordEnglish={word.item.english}
          sentenceText={gap.arabic}
          sentenceEnglish={gap.english ?? null}
          distractors={arabicPool}
          dialect={word.item.dialect}
          bare
          onAnswered={answer}
        />
      ) : word ? (
        <QuizChoiceCard
          key={key}
          format={word.format === "listen" && word.item.audioUrl ? "listen" : "meaning"}
          id={`lightning:${key}:${word.id}`}
          arabic={word.item.arabic}
          english={word.item.english}
          transliteration={word.item.transliteration}
          audioUrl={word.item.audioUrl}
          dialect={word.item.dialect}
          pool={englishPool}
          bare
          onAnswer={({ correct }) => answer(correct)}
        />
      ) : null}
    </div>
  );
};
