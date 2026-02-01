import { useState, useRef, useEffect } from "react";
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface IntroCardWord {
  id: string;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
}

interface IntroCardProps {
  word: IntroCardWord;
  gradient: string;
  onContinue: () => void;
}

export const IntroCard = ({ word, gradient, onContinue }: IntroCardProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Auto-play audio when card appears
  useEffect(() => {
    const timer = setTimeout(() => {
      playAudio();
    }, 500);
    return () => clearTimeout(timer);
  }, [word.id]);

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
  const handleAudioEnded = () => {
    setIsPlaying(false);
    setHasPlayed(true);
  };

  return (
    <div className="w-full max-w-md mx-auto text-center">
      {/* Word Card */}
      <button
        onClick={playAudio}
        className={cn(
          "relative w-full aspect-square rounded-2xl overflow-hidden mb-6",
          "transform transition-all duration-300",
          "hover:scale-[1.02] active:scale-95",
          "shadow-card bg-card border border-border",
          "focus:outline-none focus:ring-4 focus:ring-primary/50"
        )}
      >
        {/* Image Container */}
        <div className="absolute inset-4 rounded-xl overflow-hidden bg-muted flex items-center justify-center">
          {word.image_url ? (
            <img
              src={word.image_url}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-8xl opacity-30">📷</span>
          )}
        </div>

        {/* Playing indicator overlay */}
        {isPlaying && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
            <div className="w-24 h-24 rounded-full flex items-center justify-center bg-primary animate-pulse-glow">
              <Volume2 className="w-12 h-12 text-primary-foreground" />
            </div>
          </div>
        )}

        {/* Sound icon badge */}
        <div className="absolute top-4 right-4 w-12 h-12 rounded-xl flex items-center justify-center bg-primary shadow-lg">
          <Volume2 className="w-6 h-6 text-primary-foreground" />
        </div>
      </button>

      {/* Arabic Word Display */}
      <div className="mb-4 py-5 px-6 rounded-xl bg-card border border-border shadow-card">
        <p className="text-4xl font-bold text-foreground font-arabic leading-relaxed" dir="rtl">
          {word.word_arabic}
        </p>
      </div>

      {/* English Translation */}
      <div className="mb-6 py-3 px-6 rounded-xl bg-card border border-border shadow-card">
        <p className="text-xs text-muted-foreground/70 mb-1 uppercase tracking-wide font-heading">English</p>
        <p className="text-lg text-muted-foreground font-sans">
          {word.word_english}
        </p>
      </div>

      {/* Tap to hear again hint */}
      <p className="text-muted-foreground mb-6 text-sm">
        Tap the card to hear again
      </p>

      {/* Continue Button */}
      <Button
        onClick={onContinue}
        className="w-full h-12 text-lg font-semibold rounded-xl bg-primary text-primary-foreground shadow-button transition-all duration-200 hover:scale-[1.02]"
      >
        Continue to Quiz
      </Button>

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
