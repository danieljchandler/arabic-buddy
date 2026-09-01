/**
 * ShadowPlayer — orchestrates the shadowing of one clip, in repetitions:
 *   idle → playing-clip → echo-window (recording) → scoring → result → again…
 *
 * Pure UI + state. Reference audio is ALWAYS the native clip — never TTS.
 *
 * Two research-grounded choices (docs/plateau-research-2026-09.md §4):
 *
 * Repetition is the unit of work, not the take. Shadowing improves through
 * ~5 repetitions of the SAME passage before gains plateau, so one take and
 * "Next" throws away most of the exercise. The player tracks a rep count and
 * score trace per clip, offers "Again" as the primary action until the reps
 * are done, and (on auto-advance) moves on at the target rep count or when
 * the takes stop improving — whichever comes first.
 *
 * The score is closeness, not pronunciation. The Munsit transcript match says
 * whether you said the clip's words (ASR snaps to real words, so it cannot
 * see how they sounded — see src/lib/shadowScoring.ts); nothing here claims
 * per-phoneme diagnosis, which the shadowing evidence doesn't support. That
 * detail lives in the word/sentence modes, where reference-matched reading
 * makes it valid.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Loader2, RotateCcw, ArrowRight, Volume2, Gauge, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClipSourcePlayer, type ClipSourcePlayerHandle } from "./ClipSourcePlayer";
import { CountdownRing } from "./CountdownRing";
import { LevelMeter } from "./LevelMeter";
import { useShadowRecorder } from "@/hooks/useShadowRecorder";
import { useShadowScore } from "@/hooks/useShadowScore";
import { scoreBand } from "@/hooks/useAzurePronunciation";
import { repsComplete, TARGET_REPS } from "@/lib/shadowScoring";
import type { ShadowClip } from "@/hooks/useShadowQueue";

interface Props {
  clip: ShadowClip;
  threshold: number;
  autoAdvance: boolean;
  showEnglish: boolean;
  onResult: (overall: number) => void;
  onNext: () => void;
}

type State = "idle" | "playing" | "recording" | "scoring" | "result" | "error";

export function ShadowPlayer({ clip, threshold, autoAdvance, showEnglish, onResult, onNext }: Props) {
  const playerRef = useRef<ClipSourcePlayerHandle>(null);
  const recorder = useShadowRecorder();
  const { score, result, isLoading, error: scoreError, reset } = useShadowScore();
  const [state, setState] = useState<State>("idle");
  const [rate, setRate] = useState<1 | 0.75 | 0.5>(1);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [repScores, setRepScores] = useState<number[]>([]);
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipDurationMs = Math.max(800, (clip.endSec - clip.startSec) * 1000);
  const recordWindowMs = clipDurationMs + 1500;

  // Reset on clip change
  useEffect(() => {
    reset();
    setState("idle");
    setPlayerError(null);
    setRepScores([]);
    if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
    return () => {
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
      recorder.stop("manual");
      playerRef.current?.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);

  const startRecording = useCallback(() => {
    setState("recording");
    recorder.start({
      maxDurationMs: recordWindowMs,
      trailingSilenceMs: 600,
      onComplete: async (blob, reason) => {
        if (!blob) {
          setState("error");
          setPlayerError(reason === "no-audio" ? "We didn't hear you — try again." : "Recording failed");
          return;
        }
        setState("scoring");
        const res = await score(blob, {
          referenceText: clip.text,
          clipRef: clip.id,
          rep: repScores.length + 1,
        });
        if (res) {
          setState("result");
          onResult(res.overall);
          const scores = [...repScores, res.overall];
          setRepScores(scores);
          // The clip is done at the target rep count, or when the takes have
          // stopped improving — more reps past a plateau buy boredom, not
          // progress.
          if (autoAdvance && repsComplete(scores)) {
            autoAdvanceTimerRef.current = setTimeout(onNext, 1400);
          }
        } else {
          setState("error");
        }
      },
    });
  }, [autoAdvance, clip.id, clip.text, onNext, onResult, recordWindowMs, recorder, repScores, score]);

  const playClip = useCallback(async () => {
    setPlayerError(null);
    reset();
    setState("playing");
    const started = await playerRef.current?.play(rate);
    if (!started) setState("idle");
  }, [rate, reset]);

  const handleClipEnded = useCallback(() => {
    // Auto-open mic the moment the native source has paused
    startRecording();
  }, [startRecording]);

  const handleAgain = useCallback(() => {
    // Another rep of the same clip is the point of the exercise — it must
    // cancel a pending advance rather than racing it.
    if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
    reset();
    playClip();
  }, [playClip, reset]);

  const band = result ? scoreBand(result.overall) : null;
  const rep = repScores.length;
  const done = repsComplete(repScores);
  const matched = result ? result.wordDiffs.filter((d) => d.status === "match").length : 0;
  const refWords = result ? result.wordDiffs.filter((d) => d.status !== "extra").length : 0;

  return (
    <div className="space-y-4">
      {/* Source player — invisible iframe wrapped for layout; YouTube needs to mount */}
      <div className={cn(
        "w-full overflow-hidden rounded-xl border-2 border-border bg-card",
        clip.source === "youtube" ? "aspect-video" : "h-0 invisible"
      )}>
        <ClipSourcePlayer ref={playerRef} clip={clip} onEnded={handleClipEnded} onError={setPlayerError} className="w-full h-full" />
      </div>

      {/* Reference text card */}
      <div className="bg-card border-2 border-border rounded-2xl p-6 text-center">
        <p className="text-3xl font-bold leading-relaxed" dir="rtl">{clip.text}</p>
        {showEnglish && clip.translation && (
          <p className="text-muted-foreground text-base mt-3 animate-in fade-in">{clip.translation}</p>
        )}
        <p className="text-xs text-muted-foreground/70 mt-3 truncate">
          {clip.dialect} · {clip.sourceTitle}
        </p>
      </div>

      {/* Rep trace: which take you're on, and how the takes have gone. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5" aria-label="repetitions">
          {Array.from({ length: TARGET_REPS }, (_, i) => (
            <span
              key={i}
              className={cn(
                "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                i < repScores.length
                  ? repScores[i] >= threshold
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  : "bg-muted text-muted-foreground/50",
              )}
            >
              {i < repScores.length ? Math.round(repScores[i]) : i + 1}
            </span>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {rep === 0 ? `${TARGET_REPS} reps of this clip` : `Rep ${rep} of ~${TARGET_REPS}`}
        </span>
      </div>

      {/* Speed + listen controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {([1, 0.75, 0.5] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRate(r)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                rate === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {r === 1 ? "1×" : r === 0.75 ? "0.75×" : "0.5×"}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={playClip}
          disabled={state === "playing" || state === "recording" || state === "scoring"}
          className="gap-2"
        >
          <Volume2 className="h-4 w-4" />
          {state === "playing" ? "Listening…" : "Listen"}
        </Button>
      </div>

      {/* Mic / countdown area */}
      <div className="flex flex-col items-center gap-3 py-2">
        {state === "idle" && (
          <Button size="lg" onClick={playClip} className="rounded-full h-20 w-20 p-0">
            <Volume2 className="h-7 w-7" />
          </Button>
        )}

        {state === "playing" && (
          <div className="flex flex-col items-center gap-2">
            <CountdownRing durationMs={clipDurationMs} className="w-20 h-20" colorClass="text-primary">
              <Volume2 className="h-7 w-7 text-primary" />
            </CountdownRing>
            <p className="text-xs text-muted-foreground">Listen carefully…</p>
          </div>
        )}

        {state === "recording" && (
          <div className="flex flex-col items-center gap-2 w-full">
            <CountdownRing durationMs={recordWindowMs} className="w-20 h-20" colorClass="text-destructive">
              <button
                onClick={() => recorder.stop("manual")}
                className="h-14 w-14 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center animate-pulse"
                aria-label="Stop recording"
              >
                <Mic className="h-6 w-6" />
              </button>
            </CountdownRing>
            <p className="text-xs text-muted-foreground">Repeat now</p>
            <div className="w-full max-w-xs">
              <LevelMeter level={recorder.level} />
            </div>
          </div>
        )}

        {(state === "scoring" || isLoading) && (
          <div className="flex flex-col items-center gap-2 py-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Scoring…</p>
          </div>
        )}

        {(playerError || recorder.error || scoreError) && state !== "recording" && (
          <div className="text-sm text-destructive text-center flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {playerError || recorder.error || scoreError}
            {recorder.permissionDenied && (
              <span className="text-muted-foreground">— enable mic access in your browser.</span>
            )}
          </div>
        )}
      </div>

      {/* Result + actions */}
      {result && band && state === "result" && (
        <div className="bg-card border-2 border-border rounded-2xl p-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center justify-center gap-4 mb-4">
            <div className={cn(
              "inline-flex items-center justify-center w-20 h-20 rounded-full border-4",
              result.overall >= 90 ? "border-green-500" :
              result.overall >= 75 ? "border-blue-500" :
              result.overall >= 60 ? "border-yellow-500" : "border-red-500"
            )}>
              <span className={cn("text-2xl font-bold", band.color)}>{Math.round(result.overall)}</span>
            </div>
            <div>
              <p className={cn("text-base font-semibold", band.color)}>{band.label}</p>
              {/* Closeness to the clip's own words — not a pronunciation
                  diagnosis, which a transcript cannot support. */}
              <p className="text-xs text-muted-foreground">
                Closeness to the clip · said {matched} of {refWords} words
              </p>
              {done && autoAdvance && (
                <p className="text-xs text-primary mt-1 flex items-center gap-1"><Gauge className="h-3 w-3" /> Advancing…</p>
              )}
            </div>
          </div>
          {result.tips.length > 0 && (
            <ul className="mb-4 list-disc space-y-1 pl-5 text-left text-xs text-muted-foreground">
              {result.tips.slice(0, 3).map((tip, i) => (
                <li key={i}>{tip}</li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button
              variant={done ? "outline" : "default"}
              className="flex-1 gap-1.5"
              onClick={handleAgain}
            >
              <RotateCcw className="h-4 w-4" />
              Again ({Math.min(rep + 1, TARGET_REPS)}/{TARGET_REPS})
            </Button>
            <Button
              variant={done ? "default" : "outline"}
              className="flex-1 gap-1.5"
              onClick={() => { if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current); onNext(); }}
            >
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {state === "error" && !result && (
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={handleAgain}>
            <RotateCcw className="h-4 w-4 mr-1.5" /> Try again
          </Button>
          <Button variant="ghost" className="flex-1" onClick={onNext}>
            Skip <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
