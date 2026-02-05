import { useState, useRef } from "react";
import { Volume2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VocabularyWord {
  id: string;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
  image_position?: string | null;
}

interface VocabularyCardProps {
  word: VocabularyWord;
  /** Show answer text below the card */
  showAnswer?: boolean;
  /** Show tap hint overlay */
  showTapHint?: boolean;
  /** Hint text to display */
  hintText?: string;
  /** Show repeat button */
  showRepeatButton?: boolean;
  /** Callback when card is clicked */
  onCardClick?: () => void;
  /** Additional className for the container */
  className?: string;
}

/**
 * VocabularyCard - Unified vocabulary display component
 * 
 * Use this component for all vocabulary word displays including:
 * - Flashcards
 * - Review cards
 * - Intro cards
 * - Quiz cards (image portion)
 */
export const VocabularyCard = ({
  word,
  showAnswer = false,
  showTapHint = false,
  hintText = "Tap to hear",
  showRepeatButton = false,
  onCardClick,
  className,
}: VocabularyCardProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playAudio = () => {
    if (word.audio_url && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    } else {
      // Visual feedback when no audio
      setIsPlaying(true);
      setTimeout(() => setIsPlaying(false), 1000);
    }
  };

  const handleAudioPlay = () => setIsPlaying(true);
  const handleAudioEnded = () => setIsPlaying(false);

  const handleClick = () => {
    playAudio();
    onCardClick?.();
  };

  return (
    <div className={cn("relative w-full max-w-md mx-auto", className)}>
      {/* Main Card */}
      <button
        onClick={handleClick}
        className={cn(
          "relative w-full aspect-[4/3] rounded-xl overflow-hidden",
          "transform transition-all duration-200",
          "hover:scale-[1.02] active:scale-95",
          "shadow-card",
          "bg-card border border-border",
          "focus:outline-none focus:ring-2 focus:ring-primary/50"
        )}
      >
        {/* Image Container */}
        <div className="absolute inset-3 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
          {word.image_url ? (
            <img
              src={word.image_url}
              alt=""
              className="w-full h-full object-contain"
              style={{ 
                objectPosition: word.image_position 
                  ? `${word.image_position.split(' ')[0]}% ${word.image_position.split(' ')[1]}%`
                  : '50% 50%' 
              }}
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-muted-foreground/10 flex items-center justify-center">
              <Volume2 className="w-8 h-8 text-muted-foreground/40" />
            </div>
          )}
        </div>

        {/* Playing indicator overlay */}
        {isPlaying && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
            <div className="w-20 h-20 rounded-full flex items-center justify-center bg-primary animate-pulse-glow">
              <Volume2 className="w-10 h-10 text-primary-foreground" />
            </div>
          </div>
        )}

        {/* Tap hint */}
        {showTapHint && !isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="px-5 py-2.5 rounded-full bg-primary shadow-lg animate-bounce-gentle">
              <span className="text-primary-foreground font-semibold text-base flex items-center gap-2">
                <Volume2 className="w-4 h-4" />
                {hintText}
              </span>
            </div>
          </div>
        )}

        {/* Sound icon badge */}
        <div className="absolute top-3 right-3 w-10 h-10 rounded-lg flex items-center justify-center bg-primary shadow-lg">
          <Volume2 className="w-5 h-5 text-primary-foreground" />
        </div>
      </button>

      {/* Answer Display */}
      {showAnswer && (
        <div className="mt-5 text-center animate-in fade-in slide-in-from-bottom-4 duration-300">
          <p className="text-4xl font-bold text-foreground mb-2 font-arabic leading-relaxed" dir="rtl">
            {word.word_arabic}
          </p>
          <p className="text-base text-muted-foreground font-sans">
            {word.word_english}
          </p>
        </div>
      )}

      {/* Repeat Button */}
      {showRepeatButton && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            playAudio();
          }}
          className={cn(
            "absolute -bottom-5 left-1/2 transform -translate-x-1/2",
            "w-12 h-12 rounded-full",
            "flex items-center justify-center",
            "bg-primary shadow-button",
            "transition-all duration-200",
            "hover:scale-110 active:scale-95",
            isPlaying && "animate-wiggle"
          )}
        >
          <RotateCcw className="w-6 h-6 text-primary-foreground" />
        </button>
      )}

      {/* Hidden Audio Element */}
      {word.audio_url && (
        <audio
          ref={audioRef}
          src={word.audio_url}
          onPlay={handleAudioPlay}
          onEnded={handleAudioEnded}
          preload="auto"
        />
      )}
    </div>
  );
};
