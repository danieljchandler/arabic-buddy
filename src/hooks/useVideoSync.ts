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

  /** Seek the video to the start of a segment. */
  const seekToSegment = useCallback(
    (segmentId: string) => {
      const seg = segmentsRef.current.find(s => s.id === segmentId);
      if (seg && videoRef.current) {
        videoRef.current.currentTime = seg.start;
      }
    },
    [videoRef],
  );

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
