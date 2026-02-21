import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { VocabularyWord } from "@/hooks/useReview";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Volume2 } from "lucide-react";

interface ReviewImageQuizCardProps {
  word: VocabularyWord;
  /** Words from the same topic, used as distractors. */
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
 * ReviewImageQuizCard - First quiz mode used during spaced repetition review.
 *
 * Automatically plays the Arabic word audio on mount, then asks the user to
 * select the correct picture from 4 options.
 */
export const ReviewImageQuizCard = ({
  word,
  topicWords,
  fallbackWords = [],
  onAnswer,
  disabled,
}: ReviewImageQuizCardProps) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Build 4 image options: correct word + up to 3 distractors.
  // Memoised on word id so options don't reshuffle on re-renders.
  const options = useMemo(() => {
    const sameTopicPool = shuffleArray(topicWords.filter((w) => w.id !== word.id));
    const fallbackPool = shuffleArray(fallbackWords.filter((w) => w.id !== word.id));
    const distractors = [...sameTopicPool, ...fallbackPool].slice(0, 3);
    return shuffleArray([word, ...distractors]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.id]);

  const playAudio = useCallback(() => {
    if (isPlaying || !word.audio_url) return;
    // Stop any currently playing audio before starting a new one
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
    }
    setIsPlaying(true);
    const audio = new Audio(word.audio_url);
    audioRef.current = audio;
    audio.onended = () => setIsPlaying(false);
    audio.onerror = () => setIsPlaying(false);
    audio.play().catch(() => setIsPlaying(false));
  }, [word.audio_url, isPlaying]);

  // Auto-play audio when the word changes; stop on unmount.
  useEffect(() => {
    playAudio();
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
        audioRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.id]);

  const handleSelect = (option: VocabularyWord) => {
    if (showResult || disabled) return;
    const correct = option.id === word.id;
    setSelectedId(option.id);
    setShowResult(true);
    onAnswer(correct);
  };

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Audio play section */}
      <div className="text-center mb-6">
        <button
          onClick={playAudio}
          disabled={isPlaying || !word.audio_url}
          aria-label="Play word audio"
          className={cn(
            "w-20 h-20 rounded-full bg-primary flex items-center justify-center mx-auto shadow-button",
            "transition-all duration-200 hover:scale-110 active:scale-95",
            isPlaying && "animate-pulse-glow",
            (!word.audio_url) && "opacity-50 cursor-not-allowed"
          )}
        >
          <Volume2 className="w-10 h-10 text-primary-foreground" />
        </button>
        <p className="text-sm text-muted-foreground mt-3">
          {isPlaying ? "Playing…" : "Tap to listen again"}
        </p>
      </div>

      {/* Image options */}
      <p className="text-center text-sm text-muted-foreground mb-3">
        Which picture matches the word you heard?
      </p>
      <div className="grid grid-cols-2 gap-3">
        {options.map((option) => {
          const isSelected = selectedId === option.id;
          const isCorrectAnswer = option.id === word.id;

          let style = "border-2 border-border hover:border-primary";
          if (showResult) {
            if (isCorrectAnswer) {
              style = "border-2 border-success bg-success/10";
            } else if (isSelected && !isCorrectAnswer) {
              style = "border-2 border-destructive bg-destructive/10";
            }
          }

          return (
            <button
              key={option.id}
              onClick={() => handleSelect(option)}
              disabled={showResult || disabled}
              aria-label={option.word_english}
              className={cn(
                "relative rounded-xl overflow-hidden aspect-square",
                "transition-all duration-200",
                style,
                !showResult && "hover:scale-[1.02] active:scale-[0.98]",
                "disabled:cursor-not-allowed"
              )}
            >
              {option.image_url ? (
                <img
                  src={option.image_url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <Volume2 className="w-8 h-8 text-muted-foreground/40" />
                </div>
              )}
              {showResult && isCorrectAnswer && (
                <div className="absolute top-1 right-1">
                  <CheckCircle2 className="h-5 w-5 text-success drop-shadow" />
                </div>
              )}
              {showResult && isSelected && !isCorrectAnswer && (
                <div className="absolute top-1 right-1">
                  <XCircle className="h-5 w-5 text-destructive drop-shadow" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Result feedback */}
      {showResult && (
        <div
          className={cn(
            "mt-4 p-3 rounded-xl text-center text-sm font-semibold",
            "animate-in fade-in slide-in-from-bottom-4 duration-300",
            selectedId === word.id
              ? "bg-success/20 text-success-foreground"
              : "bg-destructive/20 text-destructive-foreground"
          )}
        >
          {selectedId === word.id
            ? "Correct! أحسنت"
            : `The word was: ${word.word_arabic}`}
        </div>
      )}
    </div>
  );
};
