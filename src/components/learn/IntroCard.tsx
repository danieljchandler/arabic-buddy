import { useState, useRef, useEffect } from "react";
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/design-system";
import { VocabularyCard, type VocabularyWord } from "@/components/design-system";

interface IntroCardProps {
  word: VocabularyWord;
  gradient?: string;
  onContinue: () => void;
  /** Topic label to display as a tag */
  topicLabel?: string;
}

/**
 * IntroCard - Word introduction before quiz
 * 
 * Clean, focused presentation of vocabulary with audio.
 */
export const IntroCard = ({ word, onContinue, topicLabel }: IntroCardProps) => {
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
    <div className="w-full max-w-sm mx-auto text-center">
      {/* Topic Label */}
      {topicLabel && (
        <div className="mb-3 flex justify-center">
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
            {topicLabel}
          </span>
        </div>
      )}

      {/* Word Card */}
      <div className="mb-6">
        <VocabularyCard
          word={word}
          showTapHint={false}
          onCardClick={() => setHasPlayed(true)}
        />
      </div>

      {/* Arabic Word Display */}
      <div className="mb-3 py-4 px-5 rounded-xl bg-card border border-border">
        <p className="text-2xl font-bold text-foreground font-arabic leading-relaxed" dir="rtl">
          {word.word_arabic}
        </p>
      </div>

      {/* English Translation */}
      <div className="mb-6 py-3 px-5 rounded-xl bg-card border border-border">
        <p className="text-xs text-muted-foreground/70 mb-1 uppercase tracking-wide">
          English
        </p>
        <p className="text-sm text-muted-foreground">
          {word.word_english}
        </p>
      </div>

      {/* Tap hint */}
      <p className="text-sm text-muted-foreground mb-6">
        Tap the card to hear again
      </p>

      {/* Continue Button */}
      <Button onClick={onContinue} className="w-full">
        Continue to Quiz
      </Button>

      {/* Hidden Audio Element */}
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
