import { useCallback, useEffect, useRef, useState } from 'react';
import type { Segment } from '@/types/transcript';

/**
 * Sync video playback with transcript segments.
 *
 * - Clicking a segment seeks the video to `segment.start` and plays only
 *   until `segment.end`, then pauses automatically.
 * - `activeSegmentId` / `activeWordIndex` update on video `timeupdate`
 */
export function useVideoSync(
  segments: Segment[],
  videoRef: React.RefObject<HTMLVideoElement | null>,
) {
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [activeWordIndex, setActiveWordIndex] = useState<number>(-1);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  // Tears down the current stop-at-end watcher (timeupdate listener +
  // interval); null when nothing is being watched.
  const stopAtEndCleanupRef = useRef<(() => void) | null>(null);

  /**
   * Seek the video to the start of a segment and play only that segment.
   *
   * The stop-at-end listener is attached here rather than in the useEffect
   * because videoRef.current is guaranteed to be set at this point (the user
   * just clicked a button in the rendered UI). The useEffect can miss the
   * video element if audioUrl is set after the initial mount.
   */
  const seekToSegment = useCallback(
    (segmentId: string) => {
      const seg = segmentsRef.current.find(s => s.id === segmentId);
      if (!seg || !videoRef.current) return;

      const video = videoRef.current;
      const endTime = seg.end;

      // Remove any previous stop-at-end watcher before adding a new one.
      stopAtEndCleanupRef.current?.();

      let intervalId: ReturnType<typeof setInterval> | null = null;
      const cleanup = () => {
        video.removeEventListener('timeupdate', stopAtEnd);
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        stopAtEndCleanupRef.current = null;
      };
      const stopAtEnd = () => {
        if (video.currentTime >= endTime) {
          video.pause();
          cleanup();
        }
      };
      stopAtEndCleanupRef.current = cleanup;

      video.currentTime = seg.start;
      video.addEventListener('timeupdate', stopAtEnd);
      // `timeupdate` alone fires only every ~250ms, long enough for a segment
      // to bleed the first syllable of the next one before pausing. Checking
      // the media clock on a short interval closes the boundary to ~40ms.
      intervalId = setInterval(stopAtEnd, 40);
      video.play().catch(() => cleanup());
    },
    [videoRef],
  );

  // The stop-at-end watcher is attached inside a click handler, not an
  // effect, so nothing above would clear its interval when the component
  // goes away mid-playback.
  useEffect(() => {
    return () => {
      stopAtEndCleanupRef.current?.();
    };
  }, []);

  // Track active segment/word for UI highlighting
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      const t = video.currentTime;
      const segs = segmentsRef.current;
      let foundSeg: Segment | null = null;
      let foundWord = -1;

      for (const seg of segs) {
        if (t >= seg.start && t <= seg.end) {
          foundSeg = seg;
          for (let i = 0; i < seg.words.length; i++) {
            if (t >= seg.words[i].start && t <= seg.words[i].end) {
              foundWord = i;
              break;
            }
          }
          break;
        }
      }

      setActiveSegmentId(foundSeg?.id ?? null);
      setActiveWordIndex(foundWord);
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    return () => video.removeEventListener('timeupdate', onTimeUpdate);
  }, [videoRef]);

  return { activeSegmentId, activeWordIndex, seekToSegment };
}
