import type { Segment, Word } from '@/types/transcript';

/**
 * Compute the arithmetic mean of an array of numbers.
 * Returns 0 for an empty array.
 */
export function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Split a segment into two at the boundary after the given word index.
 *
 * @param segment  - The segment to split.
 * @param splitAfterWordIndex - Index of the last word that stays in the left segment.
 * @returns A tuple `[leftSegment, rightSegment]`.
 * @throws If `splitAfterWordIndex` is out of range or would produce an empty segment.
 *
 * @example
 * ```ts
 * const [a, b] = splitSegment(segment, 2);
 * // a.words = segment.words[0..2], b.words = segment.words[3..]
 * ```
 */
export function splitSegment(
  segment: Segment,
  splitAfterWordIndex: number,
): [Segment, Segment] {
  if (splitAfterWordIndex < 0 || splitAfterWordIndex >= segment.words.length - 1) {
    throw new RangeError(
      `splitAfterWordIndex must be between 0 and ${segment.words.length - 2} (got ${splitAfterWordIndex})`,
    );
  }

  const leftWords: Word[] = segment.words.slice(0, splitAfterWordIndex + 1);
  const rightWords: Word[] = segment.words.slice(splitAfterWordIndex + 1);

  const segA: Segment = {
    ...segment,
    end: leftWords[leftWords.length - 1].end,
    text: leftWords.map(w => w.word).join(' '),
    words: leftWords,
    confidence: avg(leftWords.map(w => w.confidence)),
  };

  const segB: Segment = {
    ...segment,
    id: crypto.randomUUID(),
    start: rightWords[0].start,
    text: rightWords.map(w => w.word).join(' '),
    words: rightWords,
    confidence: avg(rightWords.map(w => w.confidence)),
  };

  return [segA, segB];
}

/**
 * Merge two adjacent segments into one.
 *
 * @param segA - The earlier segment (by time).
 * @param segB - The later segment (by time).
 * @returns A single merged segment keeping `segA.id`.
 *
 * @example
 * ```ts
 * const merged = mergeSegments(segA, segB);
 * // merged.words = [...segA.words, ...segB.words]
 * ```
 */
export function mergeSegments(segA: Segment, segB: Segment): Segment {
  const allWords = [...segA.words, ...segB.words];
  return {
    ...segA,
    end: segB.end,
    text: segA.text + ' ' + segB.text,
    words: allWords,
    confidence: avg(allWords.map(w => w.confidence)),
  };
}
