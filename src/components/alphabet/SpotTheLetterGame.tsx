import { useMemo, useState, useEffect } from "react";
import { ARABIC_LETTERS, type ArabicLetter } from "@/data/arabicAlphabet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";

interface SpotTheLetterGameProps {
  letter: ArabicLetter;
  onComplete: (score: number) => void;
}

/** Returns true if word contains any form of the target letter's base char. */
function wordContainsLetter(word: string, letter: ArabicLetter): boolean {
  // Compare against the isolated form base char (strip tatweel/diacritics in display chars).
  // Most isolated forms for these 28 letters are a single character that appears
  // directly in words.
  return word.includes(letter.isolated);
}

function pickPool(target: ArabicLetter, count: number) {
  // Collect candidate words from all 28 letters' examples, dedup.
  const all = ARABIC_LETTERS.flatMap((l) => l.examples.map((e) => e.ar));
  const unique = Array.from(new Set(all));
  // Ensure at least some contain target
  const withTarget = unique.filter((w) => wordContainsLetter(w, target));
  const without = unique.filter((w) => !wordContainsLetter(w, target));
  const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
  const picks: string[] = [];
  const want = Math.min(count, unique.length);
  const targets = shuffle(withTarget).slice(0, Math.ceil(want / 2));
  const fillers = shuffle(without).slice(0, want - targets.length);
  return shuffle([...targets, ...fillers]);
}

export const SpotTheLetterGame = ({ letter, onComplete }: SpotTheLetterGameProps) => {
  const words = useMemo(() => pickPool(letter, 8), [letter]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);

  useEffect(() => {
    setPicked({});
    setSubmitted(false);
    setScore(0);
  }, [letter.code]);

  const toggle = (w: string) => {
    if (submitted) return;
    setPicked((p) => ({ ...p, [w]: !p[w] }));
  };

  const submit = () => {
    let correct = 0;
    let totalAnswers = 0;
    for (const w of words) {
      const has = wordContainsLetter(w, letter);
      const choseYes = !!picked[w];
      totalAnswers++;
      if (has === choseYes) correct++;
    }
    const s = Math.round((correct / totalAnswers) * 100);
    setScore(s);
    setSubmitted(true);
    onComplete(s);
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">Tap every word containing</p>
        <p
          className="text-5xl font-bold text-primary mt-1"
          style={{ fontFamily: "'Noto Sans Arabic', serif" }}
        >
          {letter.isolated}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {words.map((w) => {
          const isPicked = !!picked[w];
          const isCorrectAnswer = wordContainsLetter(w, letter);
          const showResult = submitted;
          const correct = showResult && isPicked === isCorrectAnswer;
          const wrong = showResult && isPicked !== isCorrectAnswer;
          return (
            <button
              key={w}
              onClick={() => toggle(w)}
              disabled={submitted}
              className={cn(
                "p-3 rounded-xl border-2 text-2xl text-center transition-all active:scale-95",
                !showResult && isPicked && "border-primary bg-primary/10",
                !showResult && !isPicked && "border-border bg-card",
                correct && "border-green-500 bg-green-500/10",
                wrong && "border-red-500 bg-red-500/10",
              )}
              style={{ fontFamily: "'Noto Sans Arabic', serif" }}
            >
              {w}
              {showResult && (
                <span className="ml-2 inline-flex">
                  {isCorrectAnswer ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!submitted ? (
        <Button onClick={submit} className="w-full" size="lg">
          Check answers
        </Button>
      ) : (
        <div className="text-center">
          <p className="text-2xl font-bold text-primary">{score}%</p>
          <p className="text-sm text-muted-foreground">
            {score >= 80 ? "Excellent! 🌟" : score >= 50 ? "Good — keep going" : "Try again to lock it in"}
          </p>
        </div>
      )}
    </div>
  );
};
