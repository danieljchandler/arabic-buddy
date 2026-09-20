import { Loader2, Pause, Volume2 } from "lucide-react";
import { useLineAudio } from "@/hooks/useLineAudio";
import { cn } from "@/lib/utils";

interface SpeakLineButtonProps {
  /** The Arabic to say. */
  text: string;
  /** Dialect override; defaults to the learner's active dialect. */
  dialect?: string;
  /** Visible label. Omit for an icon-only button. */
  label?: string;
  className?: string;
}

/**
 * Hear one line of Arabic said aloud.
 *
 * For the lines that sit outside a `SentenceReader` — a headline, a single
 * prompt — where a whole passage's read-through would make no sense but the
 * learner still wants to know how it sounds. Nothing is synthesised until the
 * button is pressed, and the clip is kept for as long as the line is on screen,
 * so replaying it costs nothing.
 */
export const SpeakLineButton = ({ text, dialect, label, className }: SpeakLineButtonProps) => {
  const hasText = Boolean(text?.trim());
  const { playingIndex, loadingIndex, playLine } = useLineAudio({
    lines: [text],
    dialect,
  });
  const sounding = playingIndex === 0;
  const fetching = loadingIndex === 0;

  return (
    <button
      type="button"
      onClick={() => playLine(0)}
      disabled={fetching || !hasText}
      aria-label={sounding ? "Stop" : "Listen"}
      title={hasText ? undefined : "Nothing to read here yet"}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors",
        sounding
          ? "text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
        className,
      )}
    >
      {fetching ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : sounding ? (
        <Pause className="h-3.5 w-3.5" />
      ) : (
        <Volume2 className="h-3.5 w-3.5" />
      )}
      {label && <span>{label}</span>}
    </button>
  );
};
