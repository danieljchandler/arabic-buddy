import { describe, it, expect } from 'vitest';
import { avg, splitSegment, mergeSegments } from './transcriptOps';
import type { Segment } from '@/types/transcript';

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 'seg-1',
    video_id: 'vid-1',
    start: 0,
    end: 3,
    text: 'مرحبا كيف حالك',
    translation: 'Hello how are you',
    confidence: 0.9,
    words: [
      { word: 'مرحبا', start: 0, end: 1, confidence: 0.95 },
      { word: 'كيف', start: 1, end: 2, confidence: 0.9 },
      { word: 'حالك', start: 2, end: 3, confidence: 0.85 },
    ],
    ...overrides,
  };
}

describe('avg', () => {
  it('returns 0 for empty array', () => {
    expect(avg([])).toBe(0);
  });

  it('computes arithmetic mean', () => {
    expect(avg([0.8, 0.9, 1.0])).toBeCloseTo(0.9);
  });

  it('handles single value', () => {
    expect(avg([0.75])).toBe(0.75);
  });
});

describe('splitSegment', () => {
  it('splits a 3-word segment after word 0', () => {
    const seg = makeSegment();
    const [a, b] = splitSegment(seg, 0);

    expect(a.words).toHaveLength(1);
    expect(b.words).toHaveLength(2);
    expect(a.text).toBe('مرحبا');
    expect(b.text).toBe('كيف حالك');
    expect(a.end).toBe(1);
    expect(b.start).toBe(1);
    expect(a.id).toBe(seg.id); // left keeps original id
    expect(b.id).not.toBe(seg.id); // right gets new id
  });

  it('splits a 3-word segment after word 1', () => {
    const seg = makeSegment();
    const [a, b] = splitSegment(seg, 1);

    expect(a.words).toHaveLength(2);
    expect(b.words).toHaveLength(1);
    expect(a.text).toBe('مرحبا كيف');
    expect(b.text).toBe('حالك');
    expect(a.end).toBe(2);
    expect(b.start).toBe(2);
  });

  it('computes correct confidence for each half', () => {
    const seg = makeSegment();
    const [a, b] = splitSegment(seg, 0);

    expect(a.confidence).toBeCloseTo(0.95); // only first word
    expect(b.confidence).toBeCloseTo(0.875); // avg of 0.9 and 0.85
  });

  it('preserves video_id and speaker on both halves', () => {
    const seg = makeSegment({ speaker: 'host' });
    const [a, b] = splitSegment(seg, 1);

    expect(a.video_id).toBe('vid-1');
    expect(b.video_id).toBe('vid-1');
    expect(a.speaker).toBe('host');
    expect(b.speaker).toBe('host');
  });

  it('throws on negative index', () => {
    expect(() => splitSegment(makeSegment(), -1)).toThrow(RangeError);
  });

  it('throws when splitting after last word (would produce empty right)', () => {
    expect(() => splitSegment(makeSegment(), 2)).toThrow(RangeError);
  });

  it('throws on out-of-range index', () => {
    expect(() => splitSegment(makeSegment(), 10)).toThrow(RangeError);
  });
});

describe('mergeSegments', () => {
  it('merges two segments preserving first segment id', () => {
    const seg = makeSegment();
    const [a, b] = splitSegment(seg, 1);
    const merged = mergeSegments(a, b);

    expect(merged.id).toBe(a.id);
    expect(merged.words).toHaveLength(3);
    expect(merged.start).toBe(a.start);
    expect(merged.end).toBe(b.end);
  });

  it('concatenates text with a space', () => {
    const a = makeSegment({ text: 'أهلاً', words: [{ word: 'أهلاً', start: 0, end: 1, confidence: 0.9 }], end: 1 });
    const b = makeSegment({ id: 'seg-2', text: 'وسهلاً', words: [{ word: 'وسهلاً', start: 1, end: 2, confidence: 0.8 }], start: 1, end: 2 });
    const merged = mergeSegments(a, b);

    expect(merged.text).toBe('أهلاً وسهلاً');
  });

  it('computes average confidence over all words', () => {
    const a = makeSegment({
      words: [{ word: 'a', start: 0, end: 1, confidence: 1.0 }],
      end: 1,
    });
    const b = makeSegment({
      id: 'seg-2',
      words: [{ word: 'b', start: 1, end: 2, confidence: 0.5 }],
      start: 1,
      end: 2,
    });
    const merged = mergeSegments(a, b);

    expect(merged.confidence).toBeCloseTo(0.75);
  });
});
