import { useState, useEffect, useMemo } from "react";
import { VocabularyWord } from "@/hooks/useTopic";
import { QuizMode } from "@/pages/Quiz";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Volume2 } from "lucide-react";

interface QuizQuestionProps {
  mode: QuizMode;
  currentWord: VocabularyWord;
  otherWords: VocabularyWord[];
  gradient: string;
  onAnswer: (isCorrect: boolean, userAnswer: string) => void;
}

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const QuizQuestion = ({
  mode,
  currentWord,
  otherWords,
  gradient,
  onAnswer,
}: QuizQuestionProps) => {
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // Generate multiple choice options - memoize to prevent reshuffling
  const options = useMemo(() => {
    const wrongAnswers = shuffleArray(otherWords)
      .slice(0, 3)
      .map((w) => w.word_english);
    return shuffleArray([currentWord.word_english, ...wrongAnswers]);
  }, [currentWord.id, otherWords]);

  // Reset state when question changes
  useEffect(() => {
    setSelectedAnswer(null);
    setTypedAnswer("");
    setShowResult(false);
    setIsCorrect(false);
  }, [currentWord.id]);

  const playAudio = () => {
    if (currentWord.audio_url && !isPlaying) {
      setIsPlaying(true);
      const audio = new Audio(currentWord.audio_url);
      audio.onended = () => setIsPlaying(false);
      audio.onerror = () => setIsPlaying(false);
      audio.play().catch(() => setIsPlaying(false));
    }
  };

  const handleMultipleChoiceSelect = (answer: string) => {
    if (showResult) return;
    
    setSelectedAnswer(answer);
    const correct = answer === currentWord.word_english;
    setIsCorrect(correct);
    setShowResult(true);
    onAnswer(correct, answer);
  };

  const handleTypingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (showResult || !typedAnswer.trim()) return;
    
    const userAnswer = typedAnswer.trim().toLowerCase();
    const correctAnswer = currentWord.word_english.toLowerCase();
    const correct = userAnswer === correctAnswer;
    
    setIsCorrect(correct);
    setShowResult(true);
    onAnswer(correct, typedAnswer.trim());
  };

  return (
    <div className="w-full max-w-md">
      {/* Image and Arabic word display */}
      <div className="text-center mb-8">
        {currentWord.image_url ? (
          <div className="relative inline-block">
            <img
              src={currentWord.image_url}
              alt={currentWord.word_english}
              className={cn(
                "w-48 h-48 object-cover rounded-3xl shadow-card mx-auto mb-4",
                "border-4 border-card"
              )}
            />
            {currentWord.audio_url && (
              <button
                onClick={playAudio}
                className={cn(
                  "absolute -bottom-2 -right-2 p-3 rounded-full",
                  "bg-primary text-primary-foreground shadow-button",
                  "transition-all duration-200 hover:scale-110",
                  isPlaying && "animate-pulse-glow"
                )}
              >
                <Volume2 className="h-5 w-5" />
              </button>
            )}
          </div>
        ) : (
          <div className="w-48 h-48 rounded-3xl mx-auto mb-4 flex items-center justify-center bg-muted border border-border">
            <span className="text-6xl">❓</span>
          </div>
        )}
        
        <p className="text-4xl font-bold mb-2" dir="rtl">
          {currentWord.word_arabic}
        </p>
        <p className="text-muted-foreground text-lg">
          What is this in English?
        </p>
      </div>

      {/* Multiple Choice Mode */}
      {mode === "multiple-choice" && (
        <div className="grid grid-cols-2 gap-3">
          {options.map((option, index) => {
            const isSelected = selectedAnswer === option;
            const isCorrectAnswer = option === currentWord.word_english;
            
            let buttonStyle = "bg-card border-2 border-border hover:border-primary";
            
            if (showResult) {
              if (isCorrectAnswer) {
                buttonStyle = "bg-success/20 border-2 border-success text-success-foreground";
              } else if (isSelected && !isCorrectAnswer) {
                buttonStyle = "bg-destructive/20 border-2 border-destructive text-destructive-foreground";
              }
            } else if (isSelected) {
              buttonStyle = "bg-primary/20 border-2 border-primary";
            }

            return (
              <button
                key={index}
                onClick={() => handleMultipleChoiceSelect(option)}
                disabled={showResult}
                className={cn(
                  "p-4 rounded-2xl font-semibold text-lg transition-all duration-200",
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
      )}

      {/* Typing Mode */}
      {mode === "typing" && (
        <form onSubmit={handleTypingSubmit} className="space-y-4">
          <div className="relative">
            <Input
              type="text"
              value={typedAnswer}
              onChange={(e) => setTypedAnswer(e.target.value)}
              placeholder="Type the English word..."
              disabled={showResult}
              autoFocus
              className={cn(
                "text-xl text-center py-6 rounded-2xl",
                showResult && isCorrect && "border-success bg-success/10",
                showResult && !isCorrect && "border-destructive bg-destructive/10"
              )}
            />
            {showResult && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                {isCorrect ? (
                  <CheckCircle2 className="h-6 w-6 text-success" />
                ) : (
                  <XCircle className="h-6 w-6 text-destructive" />
                )}
              </div>
            )}
          </div>
          
          {!showResult && (
            <Button
              type="submit"
              disabled={!typedAnswer.trim()}
              className="w-full py-6 text-xl font-bold rounded-2xl bg-primary text-primary-foreground shadow-button"
            >
              Check Answer ✓
            </Button>
          )}
          
          {showResult && !isCorrect && (
            <div className="text-center p-4 bg-card rounded-2xl">
              <p className="text-muted-foreground mb-1">Correct answer:</p>
              <p className="text-2xl font-bold text-success">
                {currentWord.word_english}
              </p>
            </div>
          )}
        </form>
      )}

      {/* Result feedback */}
      {showResult && (
        <div className={cn(
          "mt-6 p-4 rounded-2xl text-center text-xl font-bold",
          "animate-pop",
          isCorrect ? "bg-success/20 text-success-foreground" : "bg-destructive/20 text-destructive-foreground"
        )}>
          {isCorrect ? "🎉 Correct! أحسنت!" : "❌ Not quite! حاول مرة أخرى"}
        </div>
      )}
    </div>
  );
};
