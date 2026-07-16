import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { useDialect } from "@/contexts/DialectContext";
import { cn } from "@/lib/utils";

interface LetterAudioButtonProps {
  text: string;
  /** If true, play the Fusha (MSA) pronunciation regardless of active dialect. */
  forceMsa?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
  autoplay?: boolean;
  label?: string;
}

/** MSA voice used for the Fusha button — a formal, MSA-style Arabic voice. */
const MSA_VOICE = "ar-SA-HamedNeural";
/** Explicit Azure voice per dialect. Gulf/Yemeni route through Munsit instead. */
const DIALECT_VOICE: Record<string, string> = {
  Egyptian: "ar-EG-ShakirNeural",
};

/**
 * Round speaker button. Wraps useAzureTTS to fetch and play a short clip.
 * `forceMsa` plays the Fusha voice; otherwise it follows the user's active dialect.
 */
export const LetterAudioButton = ({
  text,
  forceMsa = false,
  className,
  size = "md",
  autoplay = false,
  label,
}: LetterAudioButtonProps) => {
  const { activeDialect } = useDialect();
  // Fusha: force Azure MSA voice. Dialect: let the hook route (Munsit for
  // Gulf/Yemeni), and pass an explicit Azure voice for dialects that stay on Azure.
  const dialectProp = forceMsa ? "MSA" : undefined;
  const voice = forceMsa ? MSA_VOICE : DIALECT_VOICE[activeDialect];
  const { ttsUrl, isLoading } = useAzureTTS({
    text,
    dialect: dialectProp,
    voice,
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const autoplayedRef = useRef(false);

  // Reset the autoplay guard whenever the letter (text) changes so the next
  // letter's audio actually plays instead of being silently skipped.
  useEffect(() => {
    autoplayedRef.current = false;
  }, [text]);

  useEffect(() => {
    if (!ttsUrl) return;
    if (autoplay && !autoplayedRef.current) {
      autoplayedRef.current = true;
      const a = new Audio(ttsUrl);
      audioRef.current = a;
      a.play().catch(() => {});
    }
  }, [ttsUrl, autoplay]);

  const handlePlay = () => {
    if (!ttsUrl) return;
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const a = new Audio(ttsUrl);
    audioRef.current = a;
    setPlaying(true);
    a.onended = () => setPlaying(false);
    a.play().catch(() => setPlaying(false));
  };

  const sizeCls =
    size === "lg" ? "h-14 w-14" : size === "sm" ? "h-9 w-9" : "h-11 w-11";
  const iconCls = size === "lg" ? "h-6 w-6" : size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <button
      type="button"
      onClick={handlePlay}
      disabled={isLoading || !ttsUrl}
      aria-label={label ?? `Play ${text}`}
      className={cn(
        "rounded-full bg-primary text-primary-foreground flex items-center justify-center",
        "shadow-md transition-all duration-200 active:scale-95",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        playing && "ring-2 ring-primary/40 ring-offset-2",
        sizeCls,
        className,
      )}
    >
      <Volume2 className={iconCls} />
    </button>
  );
};
