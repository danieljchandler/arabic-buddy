import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { useDialect } from "@/contexts/DialectContext";
import { cn } from "@/lib/utils";

interface VerseAudioButtonProps {
  text: string;
  /** Optional override; defaults to the active dialect (so Gulf/Yemeni route to Munsit). */
  dialect?: string;
  className?: string;
  label?: string;
}

/**
 * Lazy play button for Bible dialect verses.
 * TTS is only requested after the user taps play.
 */
export function VerseAudioButton({ text, dialect, className, label = "Listen" }: VerseAudioButtonProps) {
  const { activeDialect } = useDialect();
  const [armed, setArmed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { ttsUrl, isLoading } = useAzureTTS({
    text,
    skip: !armed || !text?.trim(),
    dialect: dialect ?? activeDialect,
  });

  // Autoplay once the URL arrives after arming.
  useEffect(() => {
    if (!ttsUrl || !armed) return;
    const audio = new Audio(ttsUrl);
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    audio.onpause = () => setPlaying(false);
    audio.onplay = () => setPlaying(true);
    audio.play().catch(() => setPlaying(false));
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, [ttsUrl, armed]);

  const onClick = () => {
    const audio = audioRef.current;
    if (playing && audio) {
      audio.pause();
      return;
    }
    if (audio && ttsUrl) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    setArmed(true);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={isLoading}
      aria-label={playing ? "Pause verse" : `Play verse${dialect ? ` (${dialect})` : ""}`}
      className={cn("h-7 px-2 gap-1 text-xs text-primary hover:text-primary", className)}
    >
      {isLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : playing ? (
        <Pause className="h-3.5 w-3.5" />
      ) : (
        <Volume2 className="h-3.5 w-3.5" />
      )}
      <span>{label}</span>
    </Button>
  );
}
