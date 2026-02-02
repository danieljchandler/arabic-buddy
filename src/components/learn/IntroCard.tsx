import { useState, useRef, useEffect } from "react";
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/design-system";
import { VocabularyCard, type VocabularyWord } from "@/components/design-system";

interface IntroCardProps {
  word: VocabularyWord;
  gradient?: string;
  onContinue: () => void;
}

/**
 * IntroCard - Uses VocabularyCard for consistent styling with additional info display
 */
export const IntroCard = ({ word, onContinue }: IntroCardProps) => {
  const [hasPlayed, setHasPlayed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Auto-play audio when card appears
  useEffect(() => {
    const timer = setTimeout(() => {
      if (word.audio_url && audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [word.id, word.audio_url]);

  return (
    <div className="w-full max-w-md mx-auto text-center">
      {/* Word Card - using VocabularyCard */}
      <div className="mb-5">
        <VocabularyCard
          word={word}
          showTapHint={false}
          onCardClick={() => setHasPlayed(true)}
        />
      </div>

      {/* Arabic Word Display */}
      <div className="mb-3 py-4 px-5 rounded-xl bg-card border border-border shadow-card">
        <p className="text-3xl font-bold text-foreground font-arabic leading-relaxed" dir="rtl">
          {word.word_arabic}
        </p>
      </div>

      {/* English Translation */}
      <div className="mb-5 py-2.5 px-5 rounded-xl bg-card border border-border shadow-card">
        <p className="text-xs text-muted-foreground/70 mb-0.5 uppercase tracking-wide font-heading">English</p>
        <p className="text-base text-muted-foreground font-sans">
          {word.word_english}
        </p>
      </div>

      {/* Tap to hear again hint */}
      <p className="text-muted-foreground mb-5 text-sm">
        Tap the card to hear again
      </p>

      {/* Continue Button - using design system button */}
      <Button
        onClick={onContinue}
        size="lg"
        className="w-full"
      >
        Continue to Quiz
      </Button>

      {/* Hidden Audio Element for auto-play */}
      {word.audio_url && (
        <audio
          ref={audioRef}
          src={word.audio_url}
          onEnded={() => setHasPlayed(true)}
          preload="auto"
        />
      )}
    </div>
  );
};
