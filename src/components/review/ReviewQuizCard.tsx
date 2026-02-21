import { useState, useMemo } from "react";
import { VocabularyCard } from "@/components/design-system";
import { VocabularyWord } from "@/hooks/useReview";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle } from "lucide-react";

interface ReviewQuizCardProps {
  word: VocabularyWord;
  /** Words from the same topic, used as distractors. If fewer than 3 are
   *  available, `fallbackWords` (words from other topics) are used to pad. */
  topicWords: VocabularyWord[];
  /** Optional pool of words from all topics for distractor fallback */
  fallbackWords?: VocabularyWord[];
  onAnswer: (correct: boolean) => void;
  disabled?: boolean;
}

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

/**
 * ReviewQuizCard - Multiple-choice quiz card used during spaced repetition review.
 *
 * Shows the word image and plays audio, then asks the user to select the correct
 * English translation from 4 options drawn from the same topic.
 */
export const ReviewQuizCard = ({
  word,
  topicWords,
  fallbackWords = [],
  onAnswer,
  disabled,
}: ReviewQuizCardProps) => {
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);

  // Build up to 4 options: correct answer + up to 3 distractors.
  // Prefer same-topic words; fall back to other-topic words if the topic is small.
  // Memoised on word id so options don't reshuffle on re-renders.
  const options = useMemo(() => {
    const sameTopicPool = shuffleArray(topicWords.filter((w) => w.id !== word.id));
    const fallbackPool = shuffleArray(fallbackWords.filter((w) => w.id !== word.id));
    const distractors = [...sameTopicPool, ...fallbackPool]
      .slice(0, 3)
      .map((w) => w.word_english);
    return shuffleArray([word.word_english, ...distractors]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.id]);

  const handleSelect = (answer: string) => {
    if (showResult || disabled) return;
    const correct = answer === word.word_english;
    setSelectedAnswer(answer);
    setShowResult(true);
    onAnswer(correct);
  };

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Image + audio card (no Arabic text revealed yet) */}
      <VocabularyCard
        word={word}
        showAnswer={false}
        showTapHint={false}
        showRepeatButton={true}
        hintText="Tap to hear"
      />

      {/* Multiple-choice options */}
      <div className="mt-6">
        <p className="text-center text-sm text-muted-foreground mb-3">
          What does this word mean?
        </p>
        <div className="grid grid-cols-2 gap-3">
          {options.map((option, index) => {
            const isSelected = selectedAnswer === option;
            const isCorrectAnswer = option === word.word_english;

            let style = "bg-card border border-border hover:border-primary";
            if (showResult) {
              if (isCorrectAnswer) {
                style = "bg-success/20 border-2 border-success";
              } else if (isSelected && !isCorrectAnswer) {
                style = "bg-destructive/20 border-2 border-destructive";
              }
            }

            return (
              <button
                key={index}
                onClick={() => handleSelect(option)}
                disabled={showResult || disabled}
                className={cn(
                  "p-3 rounded-xl text-sm font-medium transition-all duration-200",
                  "flex items-center justify-center gap-2",
                  style,
                  !showResult && "hover:scale-[1.02] active:scale-[0.98]",
                  "disabled:cursor-not-allowed"
                )}
              >
                {showResult && isCorrectAnswer && (
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                )}
                {showResult && isSelected && !isCorrectAnswer && (
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                )}
                {option}
              </button>
            );
          })}
        </div>
      </div>

      {/* Result feedback */}
      {showResult && (
        <div
          className={cn(
            "mt-4 p-3 rounded-xl text-center text-sm font-semibold",
            "animate-in fade-in slide-in-from-bottom-4 duration-300",
            selectedAnswer === word.word_english
              ? "bg-success/20 text-success-foreground"
              : "bg-destructive/20 text-destructive-foreground"
          )}
        >
          {selectedAnswer === word.word_english
            ? "Correct! أحسنت"
            : `The answer was: ${word.word_english}`}
        </div>
      )}
    </div>
  );
};
