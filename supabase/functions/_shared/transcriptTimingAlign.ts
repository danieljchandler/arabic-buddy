/**
 * transcriptTimingAlign — put merged transcript lines back onto the audio
 * timeline using the ASR word timestamps, instead of guessing.
 *
 * The pipeline's ASR legs (Soniox, Munsit, Scribe) all return word-level
 * timestamps, but the LLM merge step rewrites the Arabic, so the merged lines
 * no longer match the ASR token stream word for word. The old answer was to
 * throw the word timings away and allocate line spans proportionally by
 * character count — which erases every pause, so any real silence in the clip
 * becomes drift that accumulates for the rest of the video. The fix is not to
 * walk indices (that is what broke) but to *align text to text*: anchor the
 * merged words to the ASR words wherever they agree, and interpolate only the
 * words in between.
 *
 * The shape of the algorithm:
 *
 *   1. Normalise both sides with the same folding the voice scorers use
 *      (arabicMatch), so spelling variance the merge introduces — hamza seats,
 *      ta marbuta, diacritics — doesn't block a match.
 *   2. Anchor on words whose normalised form appears exactly once in each
 *      stream, kept monotone by longest-increasing-subsequence. Unique words
 *      cannot be mismatched, so every anchor is trustworthy, and anchors bound
 *      how far any local mistake can spread.
 *   3. Between anchors, walk both streams forward greedily: exact match first,
 *      then fuzzy (edit-distance similarity), then the two split/merge cases
 *      Arabic orthography actually produces — one merged word covering two ASR
 *      words ("يا ولد" heard, "ياولد" written) and the reverse.
 *   4. Words that never match inherit interpolated times between their nearest
 *      matched neighbours, weighted by character length.
 *
 * If too few words match, the whole result is rejected (`null`) and the caller
 * falls back to proportional allocation — a wrong-but-bounded timeline beats a
 * confidently misaligned one.
 *
 * Pure — no I/O, no Deno APIs. Times in are seconds (the shared `AsrWord`
 * convention); times out are integer milliseconds (the `transcript_lines`
 * convention).
 */

import { levenshtein, normalizeArabic } from "./arabicMatch.ts";

/** One timed ASR word, in seconds — structurally compatible with `AsrWord`. */
export interface TimedAsrWord {
  text: string;
  start: number;
  end: number;
}

/** A word of the merged transcript with its resolved place on the timeline. */
export interface AlignedWordTiming {
  surface: string;
  startMs: number;
  endMs: number;
  /** True when the time came from a real ASR word, false when interpolated. */
  matched: boolean;
}

export interface AlignedLineTiming {
  startMs: number;
  endMs: number;
  words: AlignedWordTiming[];
}

/** Similarity floor for a fuzzy (non-exact) word match. */
const FUZZY_THRESHOLD = 0.66;

/** How many ASR words past the cursor a merged word may look for its match. */
const SEARCH_WINDOW = 10;

/** Below this fraction of matched words the alignment is not to be trusted. */
const DEFAULT_MIN_MATCH_RATIO = 0.5;

/** Fallback per-word duration for extrapolating runs past the matched region. */
const DEFAULT_WORD_SECONDS = 0.3;

interface Token {
  line: number;
  surface: string;
  norm: string;
  /** Assigned during matching/interpolation; seconds. */
  start?: number;
  end?: number;
  matched: boolean;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/**
 * Longest increasing subsequence over the ASR indices of candidate anchors,
 * so the anchor set is monotone in both streams. O(n log n), standard
 * patience-sorting form; ties are impossible because each ASR index appears
 * at most once (anchors are unique words).
 */
function monotoneAnchors(pairs: Array<{ tok: number; asr: number }>): Array<{ tok: number; asr: number }> {
  const tails: number[] = []; // indices into `pairs` of the LIS tails
  const prev: number[] = new Array(pairs.length).fill(-1);
  for (let i = 0; i < pairs.length; i++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]].asr < pairs[i].asr) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const out: Array<{ tok: number; asr: number }> = [];
  let at = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (at >= 0) {
    out.push(pairs[at]);
    at = prev[at];
  }
  return out.reverse();
}

/**
 * Align merged transcript lines to timed ASR words.
 *
 * `lineTexts` is one string of Arabic per line, in transcript order; `asrWords`
 * is the word stream from whichever engine won the alignment-source pick, on
 * the same clock as the staged audio. Returns one timing per line, or `null`
 * when the two streams disagree too much for the result to be trusted.
 */
export function alignLinesToAsrWords(
  lineTexts: string[],
  asrWords: TimedAsrWord[],
  opts: { audioDurationMs?: number; minMatchRatio?: number } = {},
): AlignedLineTiming[] | null {
  if (!Array.isArray(lineTexts) || lineTexts.length === 0) return null;

  // ── Tokenise both streams ──────────────────────────────────────────────
  const tokens: Token[] = [];
  lineTexts.forEach((text, line) => {
    for (const surface of String(text ?? "").split(/\s+/).filter(Boolean)) {
      tokens.push({ line, surface, norm: normalizeArabic(surface), matched: false });
    }
  });
  const matchable = tokens.filter((t) => t.norm.length > 0).length;
  if (matchable === 0) return null;

  const asr = (Array.isArray(asrWords) ? asrWords : [])
    .map((w) => ({
      norm: normalizeArabic(String(w?.text ?? "")),
      start: Number(w?.start),
      end: Number(w?.end),
    }))
    .filter((w) =>
      w.norm.length > 0 &&
      Number.isFinite(w.start) && Number.isFinite(w.end) &&
      w.start >= 0
    )
    .map((w) => ({ ...w, end: Math.max(w.end, w.start) }));
  if (asr.length === 0) return null;

  // ── Anchor pass: words unique in both streams, kept monotone ───────────
  const tokCounts = new Map<string, number>();
  for (const t of tokens) if (t.norm) tokCounts.set(t.norm, (tokCounts.get(t.norm) ?? 0) + 1);
  const asrCounts = new Map<string, number>();
  const asrIndexByNorm = new Map<string, number>();
  asr.forEach((w, i) => {
    asrCounts.set(w.norm, (asrCounts.get(w.norm) ?? 0) + 1);
    asrIndexByNorm.set(w.norm, i);
  });

  const candidates: Array<{ tok: number; asr: number }> = [];
  tokens.forEach((t, i) => {
    if (t.norm && tokCounts.get(t.norm) === 1 && asrCounts.get(t.norm) === 1) {
      candidates.push({ tok: i, asr: asrIndexByNorm.get(t.norm)! });
    }
  });
  const anchors = monotoneAnchors(candidates);

  for (const a of anchors) {
    const t = tokens[a.tok];
    const w = asr[a.asr];
    t.start = w.start;
    t.end = w.end;
    t.matched = true;
  }

  // ── Gap fill between anchors: exact → fuzzy → split/merge ──────────────
  // Virtual anchors bracket the streams so the loop below covers the runs
  // before the first anchor and after the last one.
  const bounds = [
    { tok: -1, asr: -1 },
    ...anchors,
    { tok: tokens.length, asr: asr.length },
  ];

  for (let b = 0; b + 1 < bounds.length; b++) {
    const tokEnd = bounds[b + 1].tok;
    const asrEnd = bounds[b + 1].asr;
    let cursor = bounds[b].asr + 1;

    for (let ti = bounds[b].tok + 1; ti < tokEnd; ti++) {
      const t = tokens[ti];
      if (!t.norm || cursor >= asrEnd) continue;
      const windowEnd = Math.min(asrEnd, cursor + SEARCH_WINDOW);

      // Exact match: take the earliest occurrence in the window.
      let hit = -1;
      for (let wi = cursor; wi < windowEnd; wi++) {
        if (asr[wi].norm === t.norm) { hit = wi; break; }
      }
      if (hit >= 0) {
        t.start = asr[hit].start;
        t.end = asr[hit].end;
        t.matched = true;
        cursor = hit + 1;
        continue;
      }

      // Fuzzy and split/merge candidates, scored together so a strong pair
      // match beats a weak single one. Position feeds the score slightly so
      // near matches beat identical-similarity far ones.
      let best: { score: number; wi: number; kind: "one" | "merge" | "split" } | null = null;
      const consider = (score: number, wi: number, kind: "one" | "merge" | "split") => {
        const adjusted = score - 0.01 * (wi - cursor);
        if (adjusted >= FUZZY_THRESHOLD && (!best || adjusted > best.score)) {
          best = { score: adjusted, wi, kind };
        }
      };
      const next = tokens[ti + 1];
      for (let wi = cursor; wi < windowEnd; wi++) {
        if (t.norm.length >= 2 && asr[wi].norm.length >= 2) {
          consider(similarity(t.norm, asr[wi].norm), wi, "one");
        }
        // One merged word covering two ASR words ("ياولد" vs "يا ولد").
        if (wi + 1 < asrEnd) {
          consider(similarity(t.norm, asr[wi].norm + asr[wi + 1].norm), wi, "merge");
        }
        // Two merged words covering one ASR word ("يا ولد" vs "ياولد").
        if (next && ti + 1 < tokEnd && next.norm) {
          consider(similarity(t.norm + next.norm, asr[wi].norm), wi, "split");
        }
      }
      if (!best) continue;
      const chosen = best as { score: number; wi: number; kind: "one" | "merge" | "split" };

      const w = asr[chosen.wi];
      if (chosen.kind === "one") {
        t.start = w.start;
        t.end = w.end;
        t.matched = true;
        cursor = chosen.wi + 1;
      } else if (chosen.kind === "merge") {
        const w2 = asr[chosen.wi + 1];
        t.start = w.start;
        t.end = w2.end;
        t.matched = true;
        cursor = chosen.wi + 2;
      } else {
        // Split one ASR word's span across the two merged tokens by length.
        const pair = tokens[ti + 1];
        const total = Math.max(1, t.norm.length + pair.norm.length);
        const mid = w.start + (w.end - w.start) * (t.norm.length / total);
        t.start = w.start;
        t.end = mid;
        t.matched = true;
        pair.start = mid;
        pair.end = w.end;
        pair.matched = true;
        cursor = chosen.wi + 1;
        ti++; // the pair token is consumed too
      }
    }
  }

  // ── Trust gate ─────────────────────────────────────────────────────────
  const matchedCount = tokens.filter((t) => t.matched).length;
  const ratio = matchedCount / matchable;
  if (ratio < (opts.minMatchRatio ?? DEFAULT_MIN_MATCH_RATIO)) return null;

  // ── Interpolate the words that never matched ───────────────────────────
  const matchedIdx = tokens.map((t, i) => (t.matched ? i : -1)).filter((i) => i >= 0);
  const durations = matchedIdx
    .map((i) => (tokens[i].end ?? 0) - (tokens[i].start ?? 0))
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  const typicalWord = durations.length > 0
    ? Math.min(0.6, Math.max(0.12, durations[Math.floor(durations.length / 2)]))
    : DEFAULT_WORD_SECONDS;

  const weight = (t: Token) => Math.max(1, t.norm.length);
  const spread = (from: number, to: number, startSec: number, endSec: number) => {
    // Distribute [startSec, endSec] over tokens[from..to] by character length.
    const run = tokens.slice(from, to + 1);
    const total = run.reduce((acc, t) => acc + weight(t), 0);
    const span = Math.max(0, endSec - startSec);
    let at = startSec;
    for (const t of run) {
      const share = (weight(t) / total) * span;
      t.start = at;
      t.end = at + share;
      at += share;
    }
  };

  const first = matchedIdx[0];
  if (first > 0) {
    const anchorStart = tokens[first].start ?? 0;
    const need = first * typicalWord;
    spread(0, first - 1, Math.max(0, anchorStart - need), anchorStart);
  }
  for (let m = 0; m + 1 < matchedIdx.length; m++) {
    const a = matchedIdx[m];
    const b = matchedIdx[m + 1];
    if (b - a > 1) {
      spread(a + 1, b - 1, tokens[a].end ?? 0, tokens[b].start ?? 0);
    }
  }
  const last = matchedIdx[matchedIdx.length - 1];
  if (last < tokens.length - 1) {
    const anchorEnd = tokens[last].end ?? 0;
    const count = tokens.length - 1 - last;
    const limit = opts.audioDurationMs && opts.audioDurationMs > 0
      ? opts.audioDurationMs / 1000
      : Number.POSITIVE_INFINITY;
    spread(last + 1, tokens.length - 1, anchorEnd, Math.min(limit, anchorEnd + count * typicalWord));
  }

  // ── Monotonic sweep ────────────────────────────────────────────────────
  // Fuzzy matching is forward-only within a segment, so order is already
  // near-monotone; this pass irons out ASR words that themselves overlap.
  let clock = 0;
  for (const t of tokens) {
    t.start = Math.max(t.start ?? clock, clock);
    t.end = Math.max(t.end ?? t.start, t.start);
    clock = t.start; // starts must not go backwards; ends may interleave
  }

  // ── Fold tokens back into lines ────────────────────────────────────────
  const out: AlignedLineTiming[] = lineTexts.map(() => ({ startMs: 0, endMs: 0, words: [] }));
  for (const t of tokens) {
    out[t.line].words.push({
      surface: t.surface,
      startMs: Math.round((t.start ?? 0) * 1000),
      endMs: Math.round((t.end ?? 0) * 1000),
      matched: t.matched,
    });
  }
  let prevEnd = 0;
  for (const line of out) {
    if (line.words.length > 0) {
      line.startMs = line.words[0].startMs;
      // Ends may interleave slightly (a merge span can outlast its neighbour),
      // so the line ends at the latest word end, not the last word's.
      line.endMs = Math.max(line.startMs, ...line.words.map((w) => w.endMs));
    } else {
      // A line with no words (blank arabic) sits where the timeline left off.
      line.startMs = prevEnd;
      line.endMs = prevEnd;
    }
    // Lines partition a monotone token stream, but rounding can produce a
    // 1ms step backwards; never let a line start before the previous one.
    line.startMs = Math.max(line.startMs, 0);
    line.endMs = Math.max(line.endMs, line.startMs);
    prevEnd = line.endMs;
  }

  return out;
}
