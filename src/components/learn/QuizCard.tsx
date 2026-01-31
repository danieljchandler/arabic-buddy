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
  gradient: string;
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

export const QuizCard = ({ word, otherWords, gradient, onAnswer }: QuizCardProps) => {
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

    // Delay before continuing to next word
    setTimeout(() => {
      onAnswer(correct);
    }, 1500);
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Question Header */}
      <div className="text-center mb-6">
        <p className="text-muted-foreground text-lg">
          Which word matches the picture?
        </p>
      </div>

      {/* Image with Audio */}
      <div className="relative mb-6">
        <button
          onClick={playAudio}
          disabled={showResult}
          className={cn(
            "w-full aspect-video rounded-2xl overflow-hidden",
            "bg-card border border-border shadow-card",
            "transition-all duration-200",
            !showResult && "hover:scale-[1.02] active:scale-[0.98]",
            "focus:outline-none focus:ring-4 focus:ring-primary/50"
          )}
        >
          <div className="absolute inset-4 rounded-xl overflow-hidden bg-muted flex items-center justify-center">
            {word.image_url ? (
              <img
                src={word.image_url}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-6xl opacity-30">📷</span>
            )}
          </div>

          {/* Playing indicator */}
          {isPlaying && (
            <div className="absolute inset-0 bg-primary/20 flex items-center justify-center rounded-2xl">
              <div className="w-16 h-16 rounded-full flex items-center justify-center bg-primary animate-pulse-glow">
                <Volume2 className="w-8 h-8 text-primary-foreground" />
              </div>
            </div>
          )}

          {/* Audio button badge */}
          <div className="absolute top-4 right-4 w-10 h-10 rounded-lg flex items-center justify-center bg-primary shadow-lg">
            <Volume2 className="w-5 h-5 text-primary-foreground" />
          </div>
        </button>

        {/* Arabic word badge */}
        <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 px-6 py-2 rounded-full bg-card border border-border shadow-card">
          <p className="text-lg font-bold text-foreground font-arabic" dir="rtl">
            {word.word_arabic}
          </p>
        </div>
      </div>

      {/* Multiple Choice Options */}
      <div className="grid grid-cols-2 gap-3 mt-8">
        {options.map((option, index) => {
          const isSelected = selectedAnswer === option;
          const isCorrectAnswer = option === word.word_english;

          let buttonStyle = "bg-card border border-border hover:border-primary/50";

          if (showResult) {
            if (isCorrectAnswer) {
              buttonStyle = "bg-success/20 border-2 border-success text-success-foreground";
            } else if (isSelected && !isCorrectAnswer) {
              buttonStyle = "bg-destructive/20 border-2 border-destructive text-destructive-foreground";
            }
          }

          return (
            <button
              key={index}
              onClick={() => handleSelect(option)}
              disabled={showResult}
              className={cn(
                "p-4 rounded-xl font-medium text-base transition-all duration-200",
                "flex items-center justify-center gap-2",
                buttonStyle,
                !showResult && "hover:scale-[1.02] active:scale-[0.98]"
              )}
            >
              {showResult && isCorrectAnswer && (
                <CheckCircle2 className="h-5 w-5 text-success" />
              )}
              {showResult && isSelected && !isCorrectAnswer && (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              {option}
            </button>
          );
        })}
      </div>

      {/* Result feedback */}
      {showResult && (
        <div className={cn(
          "mt-6 p-4 rounded-xl text-center text-lg font-semibold",
          "animate-in fade-in zoom-in-95 duration-300",
          isCorrect 
            ? "bg-success/20 text-success-foreground" 
            : "bg-destructive/20 text-destructive-foreground"
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
