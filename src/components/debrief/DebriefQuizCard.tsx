import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuizItem, QuizOutcome } from "@/lib/videoDebrief";

interface DebriefQuizCardProps {
  items: QuizItem[];
  /** Set once the quiz is finished: the card then shows what happened instead. */
  outcomes?: QuizOutcome[];
  /** Told about each answer as it is given — the debrief reschedules saved words from here. */
  onAnswer?: (item: QuizItem, correct: boolean) => void;
  onComplete: (outcomes: QuizOutcome[]) => void;
}

const SOURCE_LABEL: Record<QuizItem["source"], string> = {
  saved: "You saved this",
  looked_up: "You looked this up",
  key_vocab: "Key word from the video",
};

/**
 * The word quiz, one card per word.
 *
 * Each card shows the word and the line it was spoken in — the Arabic only,
 * since the line's translation would give the answer away — and asks for its
 * meaning. The translation arrives with the answer, so a wrong pick is
 * corrected in the sentence the learner heard it in. A word with too few
 * other meanings to choose between is asked as recall: reveal, then say
 * honestly whether you knew it.
 */
export function DebriefQuizCard({ items, outcomes, onAnswer, onComplete }: DebriefQuizCardProps) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [answers, setAnswers] = useState<QuizOutcome[]>([]);

  if (outcomes) {
    const right = outcomes.filter((o) => o.correct).length;
    return (
      <div className="rounded-xl border border-border bg-card p-3 text-sm" data-testid="debrief-quiz-summary">
        <p className="mb-2 font-semibold text-foreground">
          Quiz: {right} of {outcomes.length} right
        </p>
        <ul className="space-y-1">
          {outcomes.map((o) => (
            <li key={o.arabic} className="flex items-center gap-2">
              {o.correct ? (
                <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Knew it" />
              ) : (
                <X className="h-4 w-4 shrink-0 text-destructive" aria-label="Missed" />
              )}
              <span dir="rtl" className="font-medium" style={{ fontFamily: "var(--font-naskh)" }}>
                {o.arabic}
              </span>
              <span className="text-muted-foreground">— {o.english}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const item = items[index];
  if (!item) return null;
  const recall = item.options.length === 0;
  const answered = recall ? revealed && answers.length > index : picked !== null;
  const isLast = index === items.length - 1;

  const record = (correct: boolean, chosen?: string) => {
    const outcome: QuizOutcome = { arabic: item.arabic, english: item.english, correct };
    if (!correct && chosen) outcome.chosen = chosen;
    setAnswers((prev) => [...prev, outcome]);
    onAnswer?.(item, correct);
  };

  const pick = (optionIndex: number) => {
    if (picked !== null) return;
    setPicked(optionIndex);
    record(optionIndex === item.answerIndex, item.options[optionIndex]);
  };

  const next = () => {
    if (isLast) {
      onComplete(answers);
      return;
    }
    setIndex((i) => i + 1);
    setPicked(null);
    setRevealed(false);
  };

  return (
    <div className="rounded-xl border-2 border-primary/30 bg-card p-4" data-testid="debrief-quiz-card">
      <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Word {index + 1} of {items.length}
        </span>
        <span>{SOURCE_LABEL[item.source]}</span>
      </div>

      <p
        dir="rtl"
        className="text-center text-3xl font-bold text-foreground"
        style={{ fontFamily: "var(--font-naskh)" }}
      >
        {item.arabic}
      </p>
      {item.sentence && (
        <p dir="rtl" className="mt-2 text-center text-base text-muted-foreground" style={{ fontFamily: "var(--font-naskh)" }}>
          {item.sentence}
        </p>
      )}

      {recall ? (
        <div className="mt-4 space-y-2">
          {!revealed ? (
            <Button className="w-full" variant="outline" onClick={() => setRevealed(true)}>
              Show the meaning
            </Button>
          ) : (
            <>
              <p className="text-center text-lg font-semibold text-foreground">{item.english}</p>
              {answers.length <= index && (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => record(false)}>
                    Not yet
                  </Button>
                  <Button onClick={() => record(true)}>I knew it</Button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2" role="group" aria-label="What does it mean?">
          {item.options.map((option, optionIndex) => {
            const isAnswer = optionIndex === item.answerIndex;
            const isPicked = optionIndex === picked;
            return (
              <button
                key={option}
                type="button"
                onClick={() => pick(optionIndex)}
                disabled={picked !== null}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  picked === null && "border-border hover:border-primary hover:bg-primary/5",
                  picked !== null && isAnswer && "border-emerald-600 bg-emerald-600/10 text-foreground",
                  picked !== null && isPicked && !isAnswer && "border-destructive bg-destructive/10 text-foreground",
                  picked !== null && !isAnswer && !isPicked && "border-border opacity-60",
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      )}

      {answered && (
        <div className="mt-3 space-y-2">
          {!recall && (
            <p className={cn("text-sm font-medium", picked === item.answerIndex ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>
              {picked === item.answerIndex ? "Right!" : `It means "${item.english}".`}
            </p>
          )}
          {item.sentenceEnglish && <p className="text-xs text-muted-foreground">In the video: “{item.sentenceEnglish}”</p>}
          <Button className="w-full" onClick={next}>
            {isLast ? "Finish the quiz" : "Next word"}
          </Button>
        </div>
      )}
    </div>
  );
}
