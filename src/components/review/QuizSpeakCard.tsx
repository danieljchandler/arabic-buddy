import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Loader2, Mic, MicOff, Quote, RotateCcw, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { useAzurePronunciation, scoreBand, type WordResult } from "@/hooks/useAzurePronunciation";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useTakeRecorder } from "@/hooks/useTakeRecorder";
import { findWordSpan } from "@/lib/arabicWord";
import type { SpeechOutcome } from "@/lib/quizGrading";
import { cn } from "@/lib/utils";
import { arabicSimilarity } from "../../../supabase/functions/_shared/arabicMatch";

export interface QuizSpeechResult extends SpeechOutcome {
  /** What the recogniser heard, for the "we heard" line; null when nothing. */
  recognized: string | null;
}

interface QuizSpeakCardProps {
  /** `speak` asks for the word; `speak-sentence` for the whole line. */
  format: "speak" | "speak-sentence";
  id: string;
  arabic: string;
  english: string;
  transliteration?: string | null;
  imageUrl?: string | null;
  dialect?: string | null;
  sentence?: { arabic: string; english?: string | null } | null;
  /** Called with every scored take; the last one is what the card is graded on. */
  onResult: (result: QuizSpeechResult) => void;
  /** The device cannot record, or the learner would rather rate it themselves. */
  onUnavailable: () => void;
}

const WORD_TAKE_MS = 5000;
const LINE_TAKE_MS = 12000;

/** Azure assesses against a locale; the word's own dialect picks it. */
function localeFor(dialect: string | null | undefined): string {
  if (dialect === "Egyptian") return "ar-EG";
  if (dialect === "Yemeni") return "ar-YE";
  return "ar-SA";
}

/**
 * The speaking steps of the ladder: the meaning is shown, the learner says
 * the Arabic, and the app scores the take.
 *
 * Nothing is typed. Saying the word is the skill a spoken-dialect app is for,
 * and it is the one thing a learner cannot check alone — nobody can hear their
 * own ع. The take goes to `azure-pronunciation` with the target as the
 * reference, which returns a calibrated score and what it recognised; the
 * card shows both, because a learner who said a different word needs to see
 * that before they see a number.
 *
 * The sentence the word came from is always a tap away, with the word cut
 * out of it: context is the learner's own memory hook, not the answer.
 */
export const QuizSpeakCard = ({
  format,
  id,
  arabic,
  english,
  transliteration,
  imageUrl,
  dialect,
  sentence,
  onResult,
  onUnavailable,
}: QuizSpeakCardProps) => {
  const target = format === "speak-sentence" && sentence?.arabic ? sentence.arabic : arabic;
  const locale = localeFor(dialect);
  const { assess, result, isLoading, error, reset } = useAzurePronunciation();
  const [contextOpen, setContextOpen] = useState(false);
  const [noSpeech, setNoSpeech] = useState(false);
  // A word with a picture is asked from the picture alone; the meaning is a
  // tap away and asking for it before the take counts as help.
  const pictureOnly = format === "speak" && !!imageUrl;
  const [meaningOpen, setMeaningOpen] = useState(false);
  const hintUsedRef = useRef(false);

  // A saved phrase is several words asked as one card; give it a line's time.
  const recorder = useTakeRecorder({
    maxDurationMs: target.trim().split(/\s+/).length > 1 ? LINE_TAKE_MS : WORD_TAKE_MS,
    onTake: async (blob) => {
      setNoSpeech(false);
      const scored = await assess(blob, target, locale);
      if (!scored) return;
      const recognized = scored.recognizedText?.trim() || null;
      const similarity = recognized ? arabicSimilarity(recognized, target) : null;
      onResult({ kind: "speech", score: scored.overall, similarity, recognized, hintUsed: hintUsedRef.current });
    },
  });

  // The target's own audio, played back after the take so the learner hears
  // the model right after their own attempt.
  const { ttsUrl, isLoading: ttsLoading } = useAzureTTS({ text: target, skip: !result, dialect });
  const { play } = useAudioPlayer();

  useEffect(() => {
    reset();
    setContextOpen(false);
    setNoSpeech(false);
    setMeaningOpen(false);
    hintUsedRef.current = false;
  }, [id, reset]);

  const openMeaning = () => {
    if (!result) hintUsedRef.current = true;
    setMeaningOpen(true);
  };

  const gap = useMemo(() => {
    if (!sentence?.arabic) return null;
    const span = findWordSpan(sentence.arabic, arabic);
    if (!span) return null;
    return `${sentence.arabic.slice(0, span.start)} ـــ ${sentence.arabic.slice(span.end)}`.replace(/\s+/g, " ").trim();
  }, [sentence?.arabic, arabic]);

  // A line with no English is asked as a gap: say the whole line, with the
  // word's meaning naming what goes in the blank.
  const lineGap = format === "speak-sentence" && !sentence?.english ? gap : null;

  const startedRef = useRef(false);
  const startTake = async () => {
    startedRef.current = true;
    const ok = await recorder.start();
    if (!ok && !recorder.supported) onUnavailable();
  };

  const band = result ? scoreBand(Math.round(result.overall)) : null;
  const recognized = result?.recognizedText?.trim() || null;

  return (
    <div className="rounded-2xl bg-card border border-border p-8 text-center">
      <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-6">
        <Mic className="h-3.5 w-3.5" />
        {format === "speak" ? "Say it in Arabic" : "Say the line in Arabic"}
      </div>

      {format === "speak" && imageUrl && (
        <div className="mb-4 rounded-lg overflow-hidden bg-muted aspect-[4/3] flex items-center justify-center">
          <img src={imageUrl} alt="" className="w-full h-full object-contain" />
        </div>
      )}

      {format === "speak" ? (
        pictureOnly && !meaningOpen && !result ? (
          <div className="mb-6">
            <Button variant="ghost" size="sm" onClick={openMeaning} className="gap-1.5 text-muted-foreground">
              <Eye className="h-4 w-4" />
              Show meaning
            </Button>
          </div>
        ) : (
          <p className="text-3xl font-bold text-foreground mb-6 break-words max-w-full">{english}</p>
        )
      ) : lineGap ? (
        <div className="mb-6">
          <p className="text-2xl leading-relaxed text-foreground" style={{ fontFamily: "var(--font-naskh)" }} dir="rtl">
            {lineGap}
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Say the whole line, with <span className="font-semibold text-foreground">{english}</span> in the gap.
          </p>
        </div>
      ) : (
        <div className="mb-6">
          <p className="text-2xl font-semibold text-foreground leading-snug">{sentence?.english}</p>
          <p className="text-sm text-muted-foreground mt-2">
            with <span className="font-semibold text-foreground">{english}</span>
          </p>
        </div>
      )}

      {/* The take. */}
      {!result && !isLoading && (
        <div className="flex flex-col items-center gap-2 mb-4">
          <Button
            size="lg"
            variant={recorder.isRecording ? "destructive" : "default"}
            onClick={recorder.isRecording ? recorder.stop : startTake}
            className="gap-2 rounded-full px-6"
          >
            {recorder.isRecording ? (
              <>
                <MicOff className="h-5 w-5" />
                Stop
              </>
            ) : (
              <>
                <Mic className="h-5 w-5" />
                Say it
              </>
            )}
          </Button>
          {recorder.isRecording && (
            <p className="text-xs text-muted-foreground animate-pulse">Listening…</p>
          )}
          {noSpeech && (
            <p className="text-xs text-muted-foreground">We didn't catch anything — try once more.</p>
          )}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mb-4" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking your take…
        </div>
      )}

      {(error || recorder.error) && !isLoading && (
        <div className="text-sm text-destructive text-center mb-4" role="alert">
          {error ?? recorder.error}
          <div className="mt-2 flex justify-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => { reset(); void startTake(); }} className="gap-1">
              <RotateCcw className="h-3.5 w-3.5" />
              Retry
            </Button>
            <Button variant="ghost" size="sm" onClick={onUnavailable}>
              Rate it myself instead
            </Button>
          </div>
        </div>
      )}

      {result && band && (
        <div className="w-full max-w-xs mx-auto rounded-xl bg-muted/40 border border-border p-4 animate-in fade-in duration-300">
          <div className="mb-1">
            <span className={cn("text-3xl font-bold", band.color)}>{Math.round(result.overall)}</span>
            <span className="text-sm text-muted-foreground ml-1">/ 100</span>
          </div>
          <p className={cn("text-sm font-medium mb-3", band.color)}>{band.label}</p>

          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">We heard</p>
          <p className="text-lg mb-3" style={{ fontFamily: "var(--font-naskh)" }} dir="rtl">
            {recognized ?? "…nothing we could make out"}
          </p>

          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">The target</p>
          <div className="flex items-center justify-center gap-2">
            <p className="text-2xl font-bold text-foreground" style={{ fontFamily: "var(--font-naskh)" }} dir="rtl">
              {target}
            </p>
            <button
              type="button"
              onClick={() => ttsUrl && play(ttsUrl)}
              disabled={!ttsUrl}
              aria-label="Play the target"
              className="p-2 rounded-full bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
            >
              {ttsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>
          {format === "speak" && transliteration && (
            <p className="text-sm text-muted-foreground italic">{transliteration}</p>
          )}

          {result.words.length > 1 && (
            <div className="flex flex-wrap justify-center gap-2 mt-3" dir="rtl">
              {result.words.map((w: WordResult, i: number) => (
                <span
                  key={i}
                  className={cn("px-2 py-0.5 rounded-md text-sm font-medium bg-muted", scoreBand(w.accuracy).color)}
                >
                  {w.word}
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 flex justify-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" onClick={() => { reset(); void startTake(); }} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              Try again
            </Button>
            <AskAISentence arabic={target} english={sentence?.english ?? english} variant="chip" />
          </div>
        </div>
      )}

      {/* Context, with the word cut out: a memory hook, never the answer. */}
      {format === "speak" && gap && (
        <div className="mt-5">
          {contextOpen ? (
            <div className="rounded-lg bg-muted/40 border border-border p-3 animate-in fade-in duration-200">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Where you met it
              </p>
              <p className="text-lg leading-relaxed" style={{ fontFamily: "var(--font-naskh)" }} dir="rtl">
                {result ? sentence?.arabic : gap}
              </p>
              {sentence?.english && (
                <p className="text-sm text-muted-foreground italic mt-1">{sentence.english}</p>
              )}
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setContextOpen(true)} className="gap-1.5 text-muted-foreground">
              <Quote className="h-4 w-4" />
              Show the sentence
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
