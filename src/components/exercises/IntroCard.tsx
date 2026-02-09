import { useState } from "react";
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Props {
  wordArabic: string;
  wordEnglish: string;
  audioUrl?: string | null;
  sentenceText?: string | null;
  sentenceEnglish?: string | null;
  sentenceAudioUrl?: string | null;
  onDone: () => void;
}

export function IntroCard({
  wordArabic,
  wordEnglish,
  audioUrl,
  sentenceText,
  sentenceEnglish,
  sentenceAudioUrl,
  onDone,
}: Props) {
  const [playingWord, setPlayingWord] = useState(false);
  const [playingSentence, setPlayingSentence] = useState(false);

  const playWordAudio = () => {
    if (!audioUrl) return;
    setPlayingWord(true);
    const audio = new Audio(audioUrl);
    audio.onended = () => setPlayingWord(false);
    audio.onerror = () => setPlayingWord(false);
    audio.play().catch(() => setPlayingWord(false));
  };

  const playSentenceAudio = () => {
    if (!sentenceAudioUrl) return;
    setPlayingSentence(true);
    const audio = new Audio(sentenceAudioUrl);
    audio.onended = () => setPlayingSentence(false);
    audio.onerror = () => setPlayingSentence(false);
    audio.play().catch(() => setPlayingSentence(false));
  };

  // Auto-play word audio on mount
  useState(() => {
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.play().catch(() => {});
    }
  });

  return (
    <div className="flex flex-col items-center gap-6">
      <p className="text-sm text-muted-foreground font-medium">New Word</p>

      <div className="rounded-2xl bg-card border border-border p-8 text-center w-full max-w-sm">
        <p
          className="text-4xl font-bold text-foreground font-arabic mb-3"
          dir="rtl"
        >
          {wordArabic}
        </p>

        {audioUrl && (
          <button
            onClick={playWordAudio}
            className={cn(
              "mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4",
              "bg-primary/10 text-primary",
              "transition-all duration-200 hover:bg-primary/20",
              playingWord && "animate-pulse-glow"
            )}
          >
            <Volume2 className="h-5 w-5" />
          </button>
        )}

        <p className="text-xl text-muted-foreground font-medium mb-6">
          {wordEnglish}
        </p>

        {sentenceText && (
          <div className="border-t border-border pt-4 mt-2">
            <div className="flex items-center justify-center gap-2 mb-2">
              <p className="text-sm text-muted-foreground">Example</p>
              {sentenceAudioUrl && (
                <button
                  onClick={playSentenceAudio}
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center",
                    "bg-primary/10 text-primary hover:bg-primary/20",
                    playingSentence && "animate-pulse-glow"
                  )}
                >
                  <Volume2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <p className="text-base font-arabic text-foreground leading-relaxed mb-1" dir="rtl">
              {sentenceText}
            </p>
            {sentenceEnglish && (
              <p className="text-sm text-muted-foreground">{sentenceEnglish}</p>
            )}
          </div>
        )}
      </div>

      <Button onClick={onDone} className="w-full max-w-sm">
        Got it
      </Button>
    </div>
  );
}
