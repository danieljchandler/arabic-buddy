import { describe, it, expect } from 'vitest';
import { avg, splitSegment, mergeSegments, splitSegmentAtCursor, retokenizeSegment } from './transcriptOps';
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

describe('splitSegmentAtCursor', () => {
  it('splits after first word when cursor falls at end of first word', () => {
    const seg = makeSegment(); // text: 'مرحبا كيف حالك'
    // 'مرحبا' is 5 chars; cursor at 5 → after first word
    const [a, b] = splitSegmentAtCursor(seg, 5, seg.text);
    expect(a.words).toHaveLength(1);
    expect(b.words).toHaveLength(2);
    expect(a.end).toBe(1); // word boundary timing
    expect(b.start).toBe(1);
  });

  it('splits after second word when cursor falls in the space between word 2 and 3', () => {
    const seg = makeSegment(); // text: 'مرحبا كيف حالك', word2 ends at char 9
    // 'مرحبا كيف' = 9 chars; cursor at 9 → after word index 1
    const [a, b] = splitSegmentAtCursor(seg, 9, seg.text);
    expect(a.words).toHaveLength(2);
    expect(b.words).toHaveLength(1);
    expect(a.end).toBe(2);
    expect(b.start).toBe(2);
  });

  it('falls back to interpolation when text is edited and words do not match', () => {
    const seg = makeSegment();
    const editedText = 'مرحبا جميل كيف حالك'; // extra word inserted
    // cursor at position 12 (roughly middle)
    const [a, b] = splitSegmentAtCursor(seg, 12, editedText);
    expect(a.text).toBe(editedText.slice(0, 12).trim());
    expect(b.text).toBe(editedText.slice(12).trim());
    // Timing is interpolated: start 0, end 3; ratio ≈ 12/19
    const ratio = 12 / editedText.length;
    const expectedSplit = Math.round((0 + ratio * 3) * 1000) / 1000;
    expect(a.end).toBeCloseTo(expectedSplit, 2);
    expect(b.start).toBeCloseTo(expectedSplit, 2);
  });

  it('throws when cursor leaves no text on one side', () => {
    const seg = makeSegment();
    expect(() => splitSegmentAtCursor(seg, 0, seg.text)).toThrow(RangeError);
    expect(() => splitSegmentAtCursor(seg, seg.text.length, seg.text)).toThrow(RangeError);
  });

  it('assigns new id to right segment and keeps original id on left', () => {
    const seg = makeSegment();
    const [a, b] = splitSegmentAtCursor(seg, 5, seg.text);
    expect(a.id).toBe(seg.id);
    expect(b.id).not.toBe(seg.id);
  });
});

/**
 * Rebuilding the word list from typed text.
 *
 * The card draws its Arabic from `words`, and the video form persists each
 * line's tokens from `words` too — so before this existed, correcting a word
 * changed `text` and nothing else: the line went back to its old spelling the
 * moment the box closed, and the save wrote the old words back over the fix.
 */
describe('retokenizeSegment', () => {
  it('rebuilds the words a correction changed', () => {
    const seg = retokenizeSegment(makeSegment(), 'مرحبا كيف حالكم');

    expect(seg.text).toBe('مرحبا كيف حالكم');
    expect(seg.words.map(w => w.word)).toEqual(['مرحبا', 'كيف', 'حالكم']);
  });

  it('leaves untouched words on the timings the recogniser gave them', () => {
    const seg = retokenizeSegment(makeSegment(), 'مرحبا كيف حالكم');

    // The word-level split tool and the playhead highlight both run on these,
    // so re-deriving every word from the text would cost real information.
    expect(seg.words[0]).toEqual({ word: 'مرحبا', start: 0, end: 1, confidence: 0.95 });
    expect(seg.words[1]).toEqual({ word: 'كيف', start: 1, end: 2, confidence: 0.9 });
  });

  it('gives a replaced word the slot the old one left', () => {
    const seg = retokenizeSegment(makeSegment(), 'مرحبا كيف حالكم');

    expect(seg.words[2].start).toBe(2);
    expect(seg.words[2].end).toBe(3);
  });

  it('trusts a word a person typed', () => {
    const seg = retokenizeSegment(makeSegment(), 'مرحبا كيف حالكم');

    // A human just chose it — better evidence than any recogniser's score, and
    // the reason the word stops being coloured as doubtful.
    expect(seg.words[2].confidence).toBe(1);
  });

  it('divides one gap between a run of new words', () => {
    const seg = retokenizeSegment(makeSegment(), 'مرحبا يا صديقي حالك');

    // Two typed words share the second's second: half each, rather than each
    // claiming the whole gap and overlapping.
    expect(seg.words.map(w => [w.word, w.start, w.end])).toEqual([
      ['مرحبا', 0, 1],
      ['يا', 1, 1.5],
      ['صديقي', 1.5, 2],
      ['حالك', 2, 3],
    ]);
  });

  it('keeps the survivors aligned when a word is deleted from the front', () => {
    const seg = retokenizeSegment(makeSegment(), 'كيف حالك');

    // Matching by position would hand each survivor its neighbour's timestamps,
    // shifting the whole line half a second early.
    expect(seg.words.map(w => [w.word, w.start, w.end])).toEqual([
      ['كيف', 1, 2],
      ['حالك', 2, 3],
    ]);
  });

  it('places words appended past the last one inside the segment', () => {
    const seg = retokenizeSegment(makeSegment(), 'مرحبا كيف حالك اليوم');

    // There is no time left after the final word, and the segment's own end is
    // not this function's to move — so the new word sits on the boundary rather
    // than running past it.
    expect(seg.words[3].start).toBe(3);
    expect(seg.words[3].end).toBe(3);
  });

  it('re-averages the line confidence over its new words', () => {
    const seg = retokenizeSegment(makeSegment(), 'مرحبا كيف حالكم');

    expect(seg.confidence).toBeCloseTo((0.95 + 0.9 + 1) / 3, 5);
  });

  it('keeps the old confidence when the line is emptied', () => {
    const seg = retokenizeSegment(makeSegment(), '   ');

    // Nothing to average, and a line reading 0% because it is briefly blank
    // would be a lie about the recogniser.
    expect(seg.words).toEqual([]);
    expect(seg.confidence).toBe(0.9);
  });

  it('ignores the whitespace somebody typed around the words', () => {
    const seg = retokenizeSegment(makeSegment(), '  مرحبا   كيف  حالك ');

    expect(seg.words.map(w => w.word)).toEqual(['مرحبا', 'كيف', 'حالك']);
  });

  it('leaves everything else on the segment alone', () => {
    const original = makeSegment();
    const seg = retokenizeSegment(original, 'مرحبا كيف حالكم');

    expect(seg.id).toBe(original.id);
    expect(seg.start).toBe(original.start);
    expect(seg.end).toBe(original.end);
    expect(seg.translation).toBe(original.translation);
  });
});
