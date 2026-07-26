import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eye, Headphones, Loader2, Volume2 } from "lucide-react";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useDialect } from "@/contexts/DialectContext";
import { cn } from "@/lib/utils";

interface Props {
  wordArabic: string;
  wordEnglish: string;
  /** Recorded audio, when the word has any. TTS fills in otherwise. */
  audioUrl?: string | null;
  /**
   * The word's own dialect. Needed because /review has a "Mix All" mode that
   * serves cards from every dialect — falling back to the ambient active
   * dialect would synthesise an Egyptian word with a Gulf voice.
   */
  dialect?: string | null;
  /** Revealed state is owned by the review page so rating can gate on it. */
  showAnswer: boolean;
  onReveal: () => void;
  /**
   * Called once with the synthesised blob the first time TTS runs, so the
   * caller can persist it and skip the synthesis on later reviews.
   */
  onAudioGenerated?: (blob: Blob) => Promise<void> | void;
}

/**
 * Listening-recall card: hear the word, recall what it means.
 *
 * The direction that was missing from every deck in the app. Recognising a
 * written word tells you very little about whether you'd catch it in speech —
 * and catching it in speech is the entire point of a spoken-dialect app. The
 * Arabic is deliberately hidden until the learner reveals, so the only route to
 * the answer is the audio.
 */
export const ReviewAudioCard = ({
  wordArabic,
  wordEnglish,
  audioUrl,
  dialect,
  showAnswer,
  onReveal,
  onAudioGenerated,
}: Props) => {
  const { activeDialect } = useDialect();
  const voiceDialect = dialect ?? activeDialect;
  const [hasPlayed, setHasPlayed] = useState(false);
  const autoPlayedFor = useRef<string | null>(null);

  const { ttsUrl, isLoading, regenerate } = useAzureTTS({
    text: wordArabic,
    skip: Boolean(audioUrl),
    dialect: voiceDialect,
    persist: onAudioGenerated,
  });
  const { isPlaying, play } = useAudioPlayer();

  const playableUrl = audioUrl || ttsUrl;

  const playWord = useCallback(() => {
    if (!playableUrl) return;
    setHasPlayed(true);
    play(playableUrl);
  }, [playableUrl, play]);

  // Play once automatically when the card's audio becomes available — the card
  // is unanswerable in silence. Keyed on the word so advancing to the next card
  // re-arms it, and guarded so a re-render never replays mid-listen.
  useEffect(() => {
    if (!playableUrl) return;
    if (autoPlayedFor.current === wordArabic) return;
    autoPlayedFor.current = wordArabic;
    setHasPlayed(true);
    play(playableUrl);
  }, [playableUrl, wordArabic, play]);

  return (
    <div className="rounded-2xl bg-card border border-border p-8 text-center">
      <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-6">
        <Headphones className="h-3.5 w-3.5" />
        Listen
      </div>

      <button
        type="button"
        onClick={playWord}
        disabled={!playableUrl}
        aria-label={`Play the word again`}
        className={cn(
          "mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full border-2 transition-all duration-200",
          playableUrl
            ? "border-primary/30 bg-primary/5 hover:bg-primary/10 active:scale-95"
            : "border-border bg-muted cursor-not-allowed",
          isPlaying && "border-primary bg-primary/10",
        )}
      >
        {isLoading ? (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        ) : (
          <Volume2
            className={cn("h-8 w-8", playableUrl ? "text-primary" : "text-muted-foreground")}
          />
        )}
      </button>

      <p className="text-sm text-muted-foreground mb-6">
        {isLoading
          ? "Preparing audio…"
          : playableUrl
          ? hasPlayed
            ? "What does it mean?"
            : "Tap to listen"
          : "Audio unavailable for this word"}
      </p>

      {showAnswer ? (
        <div className="animate-in fade-in duration-200 space-y-2">
          <p
            className="text-3xl font-bold text-foreground break-words"
            style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
            dir="rtl"
          >
            {wordArabic}
          </p>
          <p className="text-lg text-muted-foreground">{wordEnglish}</p>
        </div>
      ) : (
        <Button variant="ghost" size="sm" onClick={onReveal} className="gap-1.5 text-muted-foreground">
          <Eye className="h-4 w-4" />
          Reveal
        </Button>
      )}

      {/* Without a recorded clip and without TTS there is nothing to hear, so
          offer a retry rather than stranding the learner on a silent card. */}
      {!playableUrl && !isLoading && !audioUrl && (
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={regenerate}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
};
