import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronRight, Ear, RotateCcw, Volume2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageCorner } from "@/components/shell/PageCorner";
import { LetterAudioButton } from "@/components/alphabet/LetterAudioButton";
import { Button } from "@/components/ui/button";
import { useAllWords } from "@/hooks/useAllWords";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useAuth } from "@/hooks/useAuth";
import { usePerceptionProgress } from "@/hooks/usePerceptionProgress";
import { track } from "@/lib/analytics";
import {
  buildItems,
  CONTRASTS,
  MINUTES_PER_CONTRAST,
  ROUND_SIZE,
  type Contrast,
  type InventoryWord,
  type PerceptionItem,
} from "@/lib/perceptionPairs";
import { playSuccessChime, tapFeedback } from "@/lib/tapFeedback";
import { cn } from "@/lib/utils";

/**
 * Sound pairs — perception training for the contrasts that gate Arabic
 * listening (docs/language-learning-plan-2026-09.md, Phase 2).
 *
 * The best-evidenced new feature in the plan (research §5b: perception gains
 * g = 0.92, and — unusually — no decay at 2.3 months), built to the moderators
 * that contradict the obvious design: every item is identification with an
 * Arabic-script label (never same/different, never pictures), the programme
 * is a finite ~400 minutes rather than an endless drill, and one voice per
 * word is enough to start. Pairs come from the dialect's own word inventory.
 */

const PerceptionSounds = () => {
  const { user } = useAuth();
  const { data: words, isLoading: wordsLoading } = useAllWords(false);
  const progress = usePerceptionProgress();
  const [active, setActive] = useState<Contrast | null>(null);

  const inventory: InventoryWord[] = useMemo(
    () =>
      (words ?? []).map((w) => ({
        id: w.id,
        arabic: w.word_arabic,
        english: w.word_english,
        audioUrl: w.audio_url,
      })),
    [words],
  );

  // How many items each contrast can offer from this dialect's words — shown
  // so a thin inventory reads as "not yet" rather than as a broken page.
  const available = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of CONTRASTS) map[c.id] = buildItems(inventory, c, { count: ROUND_SIZE, seed: 1 }).length;
    return map;
  }, [inventory]);

  if (active) {
    return (
      <Round
        contrast={active}
        inventory={inventory}
        resurface={progress.statusFor(active.id).resurfaceDue}
        onDone={async (result) => {
          try {
            await progress.recordRound(result);
          } catch (e) {
            console.error(e);
          }
        }}
        onExit={() => setActive(null)}
      />
    );
  }

  const { programme } = progress;
  const pct = Math.round((programme.minutes / programme.targetMinutes) * 100);

  return (
    <AppShell>
      <PageCorner />
      <div className="space-y-4 pb-10">
        <header className="flex items-center justify-between pt-2">
          <Link to="/alphabet" className="text-xs text-muted-foreground">← Alphabet</Link>
          <Link to="/skills/listen" className="text-xs text-muted-foreground">Listen →</Link>
        </header>

        <h1 className="flex items-center gap-2 text-[28px] font-bold leading-tight">
          <Ear className="h-6 w-6 text-primary" aria-hidden />
          Sound pairs
        </h1>
        <p className="text-sm text-muted-foreground">
          Hear a word, say which one it was. Nine pairs of sounds that English
          ears tend to merge — ص and س, ق and ك, ح and ه. About{" "}
          {MINUTES_PER_CONTRAST} minutes on each is what the evidence says pays;
          after that, gains level off, so this has an end.
        </p>

        <div className="flex items-center gap-3 pb-1 pt-1">
          <span className="h-1.5 flex-1 rounded-full bg-primary/15">
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </span>
          <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
            {programme.contrastsComplete} / {programme.contrastsTotal} pairs · {Math.round(programme.minutes)} min
          </span>
        </div>

        {!user && (
          <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
            You can practise signed out. Sign in to keep your progress.
          </p>
        )}

        <ul className="space-y-2" aria-label="Sound pairs">
          {CONTRASTS.map((c) => {
            const status = progress.statusFor(c.id);
            const count = available[c.id] ?? 0;
            const ready = count > 0;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={!ready || wordsLoading}
                  onClick={() => { tapFeedback(); setActive(c); }}
                  aria-label={`Practise ${c.a} versus ${c.b}`}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left",
                    "transition-transform active:scale-[0.99] disabled:opacity-50",
                  )}
                >
                  <span dir="rtl" lang="ar" className="w-16 shrink-0 text-center font-arabic text-2xl leading-none">
                    {c.a} <span className="text-muted-foreground">/</span> {c.b}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{c.cue.split(";")[0]}</span>
                    <span className="block text-xs text-muted-foreground">
                      {!ready
                        ? wordsLoading ? "Loading words…" : "No word pairs for this sound in this dialect yet"
                        : status.complete
                          ? status.resurfaceDue ? "Done — check it still holds" : "Done"
                          : `${Math.round(status.minutes)} / ${status.targetMinutes} min` +
                            (status.accuracy != null ? ` · ${Math.round(status.accuracy * 100)}% right` : "")}
                    </span>
                  </span>
                  {status.complete && !status.resurfaceDue
                    ? <Check className="h-5 w-5 shrink-0 text-emerald-600" aria-label="complete" />
                    : status.resurfaceDue
                      ? <RotateCcw className="h-5 w-5 shrink-0 text-amber-600" aria-label="check again" />
                      : <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </AppShell>
  );
};

interface RoundProps {
  contrast: Contrast;
  inventory: InventoryWord[];
  resurface: boolean;
  onDone: (result: { contrastId: string; attempts: number; correct: number; seconds: number; resurface?: boolean }) => Promise<void>;
  onExit: () => void;
}

function Round({ contrast, inventory, resurface, onDone, onExit }: RoundProps) {
  const seed = useMemo(() => Math.floor(Math.random() * 1_000_000) + 1, []);
  const items = useMemo(() => buildItems(inventory, contrast, { count: ROUND_SIZE, seed }), [inventory, contrast, seed]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const [finished, setFinished] = useState(false);
  const startedAt = useRef(Date.now());
  const { play } = useAudioPlayer();
  const recorded = useRef(false);

  const item: PerceptionItem | undefined = items[index];

  // Play the prompt as each item arrives; the learner can replay it.
  useEffect(() => {
    if (item?.prompt.audioUrl) play(item.prompt.audioUrl);
  }, [item, play]);

  const choose = useCallback((optionIndex: number) => {
    if (!item || picked !== null) return;
    tapFeedback();
    setPicked(optionIndex);
    if (item.options[optionIndex].correct) setCorrect((n) => n + 1);
  }, [item, picked]);

  const next = useCallback(async () => {
    if (index + 1 < items.length) {
      setIndex((i) => i + 1);
      setPicked(null);
      return;
    }
    setFinished(true);
  }, [index, items.length]);

  useEffect(() => {
    if (!finished || recorded.current) return;
    recorded.current = true;
    const seconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
    if (correct / Math.max(1, items.length) >= 0.7) playSuccessChime();
    track("perception_round", { contrast: contrast.id, attempts: items.length, correct, seconds, resurface });
    void onDone({ contrastId: contrast.id, attempts: items.length, correct, seconds, resurface });
  }, [finished, correct, items.length, contrast.id, resurface, onDone]);

  if (items.length === 0) {
    return (
      <AppShell>
        <PageCorner />
        <div className="mt-8 space-y-3 text-center">
          <p className="text-muted-foreground">No word pairs for this sound in this dialect yet.</p>
          <Button onClick={onExit}>Back</Button>
        </div>
      </AppShell>
    );
  }

  if (finished) {
    const pct = Math.round((correct / items.length) * 100);
    return (
      <AppShell>
        <PageCorner />
        <div className="mt-10 space-y-4 text-center">
          <h1 className="text-2xl font-bold">{correct} of {items.length}</h1>
          <p className="text-muted-foreground">
            {resurface
              ? "First try after the break — this is the number that says whether it stuck."
              : pct >= 80
                ? "Your ear is telling these apart."
                : "Keep going — the difference gets easier to hear with time on it."}
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={onExit}>All pairs</Button>
            <Button onClick={() => { setIndex(0); setPicked(null); setCorrect(0); setFinished(false); recorded.current = false; startedAt.current = Date.now(); }}>
              Another round
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const answered = picked !== null;
  const wasRight = answered && item!.options[picked!].correct;

  return (
    <AppShell>
      <PageCorner />
      <div className="space-y-5 pb-10">
        <header className="flex items-center justify-between pt-2">
          <button type="button" onClick={onExit} className="text-xs text-muted-foreground">← All pairs</button>
          <span className="text-xs tabular-nums text-muted-foreground">{index + 1} / {items.length}</span>
        </header>

        <p className="text-sm text-muted-foreground">
          {item!.kind === "pair" ? "Which word did you hear?" : `Which sound was in that word — ${contrast.a} or ${contrast.b}?`}
        </p>

        <div className="flex items-center justify-center py-2">
          {item!.prompt.audioUrl ? (
            <button
              type="button"
              onClick={() => play(item!.prompt.audioUrl!)}
              aria-label="Play again"
              className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              <Volume2 className="h-7 w-7" />
            </button>
          ) : (
            <LetterAudioButton text={item!.prompt.arabic} size="lg" autoplay label="Play again" />
          )}
        </div>

        <div className={cn("grid gap-3", item!.options.length > 2 ? "grid-cols-2" : "grid-cols-2")}>
          {item!.options.map((opt, i) => {
            const state = !answered ? "idle" : opt.correct ? "correct" : i === picked ? "wrong" : "idle";
            return (
              <button
                key={`${opt.label}-${i}`}
                type="button"
                onClick={() => choose(i)}
                disabled={answered}
                dir="rtl"
                lang="ar"
                className={cn(
                  "rounded-2xl border px-4 py-6 text-center font-arabic text-3xl leading-none transition-colors",
                  state === "idle" && "border-border bg-card",
                  state === "correct" && "border-emerald-500 bg-emerald-500/10",
                  state === "wrong" && "border-rose-500 bg-rose-500/10",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {answered && (
          <div className="space-y-3" role="status">
            <p className={cn("text-sm font-semibold", wasRight ? "text-emerald-700" : "text-rose-700")}>
              {wasRight ? "Right." : "Not that one."}
            </p>
            <p className="text-sm text-muted-foreground">{item!.feedback}</p>
            {item!.kind === "pair" && (
              <p className="text-xs text-muted-foreground">
                <span dir="rtl" lang="ar" className="font-arabic">{item!.prompt.arabic}</span> — {item!.prompt.english}
              </p>
            )}
            <Button className="w-full" onClick={next}>
              {index + 1 < items.length ? "Next" : "Finish"}
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default PerceptionSounds;
