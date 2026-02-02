import { useState, useMemo, useRef, useEffect } from "react";
import { CheckCircle2, XCircle, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuizCardWord {
  id: string;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
}

interface QuizCardProps {
  word: QuizCardWord;
  otherWords: QuizCardWord[];
  gradient?: string;
  onAnswer: (isCorrect: boolean) => void;
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
 * QuizCard - Learning quiz with multiple choice
 * 
 * Clean, focused design for vocabulary testing.
 */
export const QuizCard = ({ word, otherWords, onAnswer }: QuizCardProps) => {
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Generate options only once per word
  const options = useMemo(() => {
    const wrongAnswers = shuffleArray(otherWords)
      .filter(w => w.id !== word.id)
      .slice(0, 3)
      .map(w => w.word_english);
    return shuffleArray([word.word_english, ...wrongAnswers]);
  }, [word.id, otherWords]);

  // Auto-play audio when quiz appears
  useEffect(() => {
    const timer = setTimeout(() => {
      playAudio();
    }, 300);
    return () => clearTimeout(timer);
  }, [word.id]);

  const playAudio = () => {
    if (word.audio_url && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    } else {
      setIsPlaying(true);
      setTimeout(() => setIsPlaying(false), 800);
    }
  };

  const handleSelect = (answer: string) => {
    if (showResult) return;

    setSelectedAnswer(answer);
    const correct = answer === word.word_english;
    setIsCorrect(correct);
    setShowResult(true);

    setTimeout(() => {
      onAnswer(correct);
    }, 1500);
  };

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Question Header */}
      <div className="text-center mb-4">
        <p className="text-sm text-muted-foreground">
          Which word matches?
        </p>
      </div>

      {/* Image with Audio */}
      <div className="relative mb-6">
        <button
          onClick={playAudio}
          disabled={showResult}
          className={cn(
            "w-full aspect-[4/3] rounded-xl overflow-hidden",
            "bg-card border border-border",
            "transition-all duration-200",
            !showResult && "hover:border-primary/30",
            "focus:outline-none focus:ring-2 focus:ring-primary/30"
          )}
        >
          <div className="absolute inset-3 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
            {word.image_url ? (
              <img
                src={word.image_url}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-muted-foreground/10 flex items-center justify-center">
                <Volume2 className="w-6 h-6 text-muted-foreground/40" />
              </div>
            )}
          </div>

          {/* Playing indicator */}
          {isPlaying && (
            <div className="absolute inset-0 bg-primary/10 flex items-center justify-center rounded-xl">
              <div className="w-12 h-12 rounded-full flex items-center justify-center bg-primary animate-pulse-glow">
                <Volume2 className="w-6 h-6 text-primary-foreground" />
              </div>
            </div>
          )}

          {/* Audio button badge */}
          <div className="absolute top-3 right-3 w-8 h-8 rounded-lg flex items-center justify-center bg-primary/90">
            <Volume2 className="w-4 h-4 text-primary-foreground" />
          </div>
        </button>

        {/* Arabic word badge */}
        <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 px-4 py-1.5 rounded-full bg-card border border-border">
          <p className="text-sm font-bold text-foreground font-arabic" dir="rtl">
            {word.word_arabic}
          </p>
        </div>
      </div>

      {/* Multiple Choice Options */}
      <div className="grid grid-cols-2 gap-2 mt-6">
        {options.map((option, index) => {
          const isSelected = selectedAnswer === option;
          const isCorrectAnswer = option === word.word_english;

          let buttonStyle = "bg-card border border-border hover:border-primary/30";

          if (showResult) {
            if (isCorrectAnswer) {
              buttonStyle = "bg-success/10 border border-success";
            } else if (isSelected && !isCorrectAnswer) {
              buttonStyle = "bg-destructive/10 border border-destructive";
            }
          }

          return (
            <button
              key={index}
              onClick={() => handleSelect(option)}
              disabled={showResult}
              className={cn(
                "p-3 rounded-lg text-sm transition-all duration-200",
                "flex items-center justify-center gap-2",
                buttonStyle
              )}
            >
              {showResult && isCorrectAnswer && (
                <CheckCircle2 className="h-4 w-4 text-success" />
              )}
              {showResult && isSelected && !isCorrectAnswer && (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <span className="text-foreground">{option}</span>
            </button>
          );
        })}
      </div>

      {/* Result feedback */}
      {showResult && (
        <div className={cn(
          "mt-4 p-3 rounded-lg text-center text-sm font-medium",
          "animate-in fade-in zoom-in-95 duration-300",
          isCorrect 
            ? "bg-success/10 text-success" 
            : "bg-destructive/10 text-destructive"
        )}>
          {isCorrect ? "Correct! أحسنت" : "Not quite — keep practicing"}
        </div>
      )}

      {/* Hidden Audio Element */}
      {word.audio_url && (
        <audio
          ref={audioRef}
          src={word.audio_url}
          onPlay={() => setIsPlaying(true)}
          onEnded={() => setIsPlaying(false)}
          preload="auto"
        />
      )}
    </div>
  );
};
