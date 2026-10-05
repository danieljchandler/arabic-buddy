import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LineShadowPanel } from "@/components/pronunciation/LineShadowPanel";
import { buildLineShadowClip, type ClipVideo } from "@/lib/lineShadowClip";
import { extractAudioClipFromUrl } from "@/lib/vocabularyAudioContext";
import type { ShadowScoreResult } from "@/hooks/useShadowScore";
import type { ShadowLine, ShadowOutcome } from "@/lib/videoDebrief";

interface DebriefShadowCardProps {
  line: ShadowLine;
  video: ClipVideo | null | undefined;
  /** The video's downloadable audio, when it has one — enables the acoustic half of the score. */
  audioUrl: string | null;
  /** Set once the line was said or skipped: the card then shows that instead. */
  outcome?: ShadowOutcome;
  onDone: (outcome: ShadowOutcome) => void;
}

/**
 * One line to say aloud, after the native speaker.
 *
 * The shadowing panel from the video page, put in the conversation. The
 * learner may take it as many times as they like; what is reported back to
 * the tutor when they are done is their best take, since the point of
 * repeating is to get better at it. Closing the panel before any take, or
 * skipping, reports the line as skipped rather than as a zero.
 */
export function DebriefShadowCard({ line, video, audioUrl, outcome, onDone }: DebriefShadowCardProps) {
  const [nativeClipWav, setNativeClipWav] = useState<Blob | null>(null);
  const best = useRef<ShadowScoreResult | null>(null);

  const clip = useMemo(
    () =>
      buildLineShadowClip(
        { id: line.lineId, arabic: line.arabic, translation: line.translation, startMs: line.startMs, endMs: line.endMs },
        video,
        audioUrl,
      ),
    [line, video, audioUrl],
  );

  useEffect(() => {
    if (outcome || !audioUrl) return;
    let cancelled = false;
    extractAudioClipFromUrl(audioUrl, line.startMs, line.endMs)
      .then((blob) => {
        if (!cancelled) setNativeClipWav(blob);
      })
      .catch(() => {
        // The acoustic half of the score is optional.
      });
    return () => {
      cancelled = true;
    };
  }, [audioUrl, line.startMs, line.endMs, outcome]);

  const handleResult = useCallback((result: ShadowScoreResult) => {
    if (!best.current || result.overall > best.current.overall) best.current = result;
  }, []);

  const finish = useCallback(() => {
    const take = best.current;
    onDone({
      lineNumber: line.lineNumber,
      arabic: line.arabic,
      score: take ? take.overall : null,
      heard: take?.recognizedText,
    });
  }, [line.arabic, line.lineNumber, onDone]);

  if (outcome) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-sm" data-testid="debrief-shadow-summary">
        <Mic className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span dir="rtl" className="min-w-0 flex-1 truncate" style={{ fontFamily: "var(--font-naskh)" }}>
          {outcome.arabic}
        </span>
        <span className="shrink-0 font-medium text-muted-foreground">
          {outcome.score === null ? "Skipped" : `${Math.round(outcome.score)}/100`}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="debrief-shadow-card">
      <p className="text-xs font-medium text-muted-foreground">Line {line.lineNumber} of the video</p>
      {clip ? (
        <LineShadowPanel
          clip={clip}
          nativeClipWav={nativeClipWav}
          onClose={finish}
          onResult={handleResult}
          recordAttempt={false}
        />
      ) : (
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p dir="rtl" className="text-2xl font-bold" style={{ fontFamily: "var(--font-naskh)" }}>
            {line.arabic}
          </p>
          {line.translation && <p className="mt-1 text-sm text-muted-foreground">{line.translation}</p>}
          <p className="mt-3 text-xs text-muted-foreground">The clip for this line can't be played here.</p>
        </div>
      )}
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={finish}>
        <SkipForward className="h-3.5 w-3.5" aria-hidden />
        {clip ? "I'm done with this line" : "Skip this line"}
      </Button>
    </div>
  );
}
