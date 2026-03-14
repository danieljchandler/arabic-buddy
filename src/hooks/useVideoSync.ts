import { useCallback, useEffect, useRef, useState } from 'react';
import type { Segment } from '@/types/transcript';

/**
 * Sync video playback with transcript segments.
 *
 * - Clicking a segment seeks the video to `segment.start`
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
  // End time for single-segment playback; null means play freely
  const segmentEndRef = useRef<number | null>(null);
  // True when WE programmatically called pause (to stop at segment end)
  const programmaticPauseRef = useRef(false);

  /** Seek the video to the start of a segment and play only that segment. */
  const seekToSegment = useCallback(
    (segmentId: string) => {
      const seg = segmentsRef.current.find(s => s.id === segmentId);
      if (seg && videoRef.current) {
        videoRef.current.currentTime = seg.start;
        segmentEndRef.current = seg.end;
        videoRef.current.play().catch(() => {});
      }
    },
    [videoRef],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      const t = video.currentTime;

      // Stop at segment end if triggered via seekToSegment
      if (segmentEndRef.current !== null && t >= segmentEndRef.current) {
        segmentEndRef.current = null;
        programmaticPauseRef.current = true;
        video.pause();
      }

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

    // If the user manually pauses (not us), clear the segment lock so
    // resuming playback via the top controls works without re-triggering stop.
    const onPause = () => {
      if (programmaticPauseRef.current) {
        programmaticPauseRef.current = false;
      } else {
        segmentEndRef.current = null;
      }
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('pause', onPause);
    };
  }, [videoRef]);

  return { activeSegmentId, activeWordIndex, seekToSegment };
}
