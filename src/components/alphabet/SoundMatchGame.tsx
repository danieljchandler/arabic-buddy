import { useMemo, useState, useEffect } from "react";
import { ARABIC_LETTERS, type ArabicLetter } from "@/data/arabicAlphabet";
import { LetterAudioButton } from "./LetterAudioButton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SoundMatchGameProps {
  letter: ArabicLetter;
  /** Pool of allowed distractor letters (defaults to all). */
  pool?: ArabicLetter[];
  onComplete: (score: number) => void;
}

/** Hear the target letter, pick from 4 letters. 3 rounds, score 0–100. */
export const SoundMatchGame = ({ letter, pool, onComplete }: SoundMatchGameProps) => {
  const allPool = pool ?? ARABIC_LETTERS;

  const rounds = useMemo(() => {
    const target = letter;
    const others = allPool.filter((l) => l.code !== target.code);
    const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
    const distractors = shuffle(others).slice(0, 3);
    const options = shuffle([target, ...distractors]);
    return [{ target, options }];
    // single round per visit keeps the lesson tight; the boss checkpoint composes its own multi-round
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter.code]);

  const [picked, setPicked] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setPicked(null);
    setDone(false);
  }, [letter.code]);

  const round = rounds[0];
  const correct = picked === round.target.code;

  const choose = (code: string) => {
    if (picked) return;
    setPicked(code);
    setDone(true);
    onComplete(code === round.target.code ? 100 : 0);
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <p className="text-sm text-muted-foreground">Tap the speaker, then pick the letter you heard</p>
        <div className="flex justify-center">
          <LetterAudioButton text={round.target.name_ar} forceMsa size="lg" autoplay label="Play letter sound" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {round.options.map((l) => {
          const isPicked = picked === l.code;
          const showResult = done && isPicked;
          return (
            <button
              key={l.code}
              onClick={() => choose(l.code)}
              disabled={!!picked}
              className={cn(
                "p-6 rounded-2xl border-2 transition-all active:scale-95",
                !picked && "border-border bg-card hover:border-primary/40",
                showResult && correct && "border-green-500 bg-green-500/10",
                showResult && !correct && "border-red-500 bg-red-500/10",
                done && !isPicked && l.code === round.target.code && "border-green-500/60 bg-green-500/5",
              )}
              style={{ fontFamily: "'Noto Sans Arabic', serif", fontSize: 56, lineHeight: 1 }}
            >
              {l.isolated}
            </button>
          );
        })}
      </div>

      {done && (
        <p className="text-center text-sm">
          {correct ? (
            <span className="text-green-600 font-semibold">Correct! 🎉</span>
          ) : (
            <span className="text-muted-foreground">
              The letter was{" "}
              <span className="font-bold text-foreground" style={{ fontFamily: "'Noto Sans Arabic', serif" }}>
                {round.target.isolated}
              </span>{" "}
              ({round.target.name_translit})
            </span>
          )}
        </p>
      )}
    </div>
  );
};
