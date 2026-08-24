import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Playing one line of a transcript, over and over, slowly.
 *
 * This is the single most-used control in a transcription tool and it is not
 * the same thing as playing the video. A reviewer checking whether a word is
 * وايد or واجد wants that half-second, at half speed, five times in a row,
 * without losing their place in the file — so the unit of playback here is a
 * line's span, not the timeline.
 *
 * The speed is the editor's own and never touches the published video: nothing
 * here is persisted to the video record, and the element's rate is put back to
 * normal when playback stops, so the full-video controls behave as they always
 * did.
 */

/** Offered in the toolbar. 0.5 is the slowest that stays intelligible. */
export const PLAYBACK_RATES = [0.5, 0.65, 0.8, 1] as const;

/** What the one-click "slow" button on each line uses. */
export const SLOW_RATE = 0.6;

/**
 * Rewind a hair before the line starts.
 *
 * ASR boundaries habitually clip the first consonant, and a line that begins
 * mid-word is exactly the line a reviewer is trying to check. 120 ms is enough
 * to hear the onset without dragging in the previous word.
 */
export const LEAD_IN_SECONDS = 0.12;

export interface LineSpan {
  id: string;
  /** Seconds. */
  start: number;
  /** Seconds. */
  end: number;
}

export interface LinePlayback {
  playingLineId: string | null;
  rate: number;
  setRate: (rate: number) => void;
  loop: boolean;
  setLoop: (loop: boolean) => void;
  /** Play just this line. `overrideRate` applies to this playback only. */
  playLine: (span: LineSpan, overrideRate?: number) => void;
  /** Play this line at the slow rate, whatever the toolbar says. */
  playLineSlow: (span: LineSpan) => void;
  stop: () => void;
}

export function useLinePlayback(
  mediaRef: { current: HTMLMediaElement | null },
): LinePlayback {
  const [playingLineId, setPlayingLineId] = useState<string | null>(null);
  const [rate, setRateState] = useState(1);
  const [loop, setLoop] = useState(false);

  const frameRef = useRef<number | null>(null);
  const spanRef = useRef<LineSpan | null>(null);
  const loopRef = useRef(loop);
  const rateRef = useRef(rate);

  // The animation-frame watcher reads these rather than closing over them, so
  // toggling loop or speed mid-playback takes effect on the current line
  // instead of on the next one.
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    cancelFrame();
    spanRef.current = null;
    setPlayingLineId(null);
    const media = mediaRef.current;
    if (media) {
      media.pause();
      // Back to normal, so a reviewer who then scrubs the whole video is not
      // stuck at the speed they used to check one word.
      media.playbackRate = 1;
    }
  }, [cancelFrame, mediaRef]);

  useEffect(() => cancelFrame, [cancelFrame]);

  /**
   * Watch the clock at frame rate rather than on `timeupdate`.
   *
   * `timeupdate` fires about four times a second, so stopping on it overshoots
   * the end of a line by up to 250 ms — long enough to hear the first syllable
   * of the next line, which is the exact confusion this control exists to
   * prevent.
   */
  const watch = useCallback(() => {
    const media = mediaRef.current;
    const span = spanRef.current;
    if (!media || !span) return;

    if (media.currentTime >= span.end) {
      if (loopRef.current) {
        media.currentTime = Math.max(0, span.start - LEAD_IN_SECONDS);
        void media.play().catch(() => stop());
      } else {
        stop();
        return;
      }
    }
    frameRef.current = requestAnimationFrame(watch);
  }, [mediaRef, stop]);

  const playLine = useCallback(
    (span: LineSpan, overrideRate?: number) => {
      const media = mediaRef.current;
      if (!media) return;
      if (!Number.isFinite(span.start) || !Number.isFinite(span.end) || span.end <= span.start) {
        return;
      }

      cancelFrame();
      spanRef.current = span;
      setPlayingLineId(span.id);

      media.playbackRate = overrideRate ?? rateRef.current;
      media.currentTime = Math.max(0, span.start - LEAD_IN_SECONDS);
      void media.play().catch(() => {
        // Autoplay refusal, or a source that never loaded. Either way there is
        // no audio, and leaving the row lit as "playing" would be a lie.
        stop();
      });
      frameRef.current = requestAnimationFrame(watch);
    },
    [cancelFrame, mediaRef, stop, watch],
  );

  const playLineSlow = useCallback(
    (span: LineSpan) => playLine(span, SLOW_RATE),
    [playLine],
  );

  const setRate = useCallback(
    (next: number) => {
      setRateState(next);
      const media = mediaRef.current;
      // Applied straight away so a change lands on the line already playing.
      if (media && spanRef.current) media.playbackRate = next;
    },
    [mediaRef],
  );

  return { playingLineId, rate, setRate, loop, setLoop, playLine, playLineSlow, stop };
}
