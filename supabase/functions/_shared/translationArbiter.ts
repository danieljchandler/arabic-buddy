// =============================================================================
// Token-overlap similarity, and using a third-party rendering to settle a
// disputed line.
//
// The translation ensemble clusters Gemini/Claude/Qwen by Jaccard overlap and
// flags a line `needs_review` when no cluster reaches a winning weight. The
// Shaheen-MT tiebreak was then asked for a rendering of exactly those lines —
// and did nothing with it: an already-populated line kept the ensemble's text,
// carried Shaheen's as `altTranslation`, and stayed flagged. Every audit read
// the same way: "tiebreak fired, filled 0 disputes", because `filled` only ever
// counted lines the ensemble had left *empty*.
//
// A tiebreak that cannot break a tie is just an extra API call. Shaheen is an
// Arabic-native dedicated MT model, so when its rendering clearly backs one of
// the disputed candidates, that is a real vote — enough to settle the line.
// =============================================================================

export function normalizeForCompare(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[.,!?;:'"()[\]{}…—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token-set overlap of two strings, 0..1. */
export function jaccard(a: string, b: string): number {
  const ta = new Set(normalizeForCompare(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeForCompare(b).split(' ').filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export interface ArbiterCandidate {
  name: string;
  weight: number;
  text: string;
  literal: string;
}

export interface Arbitration {
  /** The candidate the arbiter's rendering backs, or null when it backs none. */
  winner: ArbiterCandidate | null;
  /** Overlap between the winner and the arbiter's text. */
  score: number;
  /** How far ahead of the runner-up the winner is. 0 when it stands alone. */
  margin: number;
  /** Why no winner was chosen, for provenance. */
  reason?: 'no_arbiter_text' | 'no_candidates' | 'below_threshold' | 'too_close';
}

/**
 * Minimum overlap with the arbiter before a candidate counts as "backed".
 * Below the ensemble's own 0.6 clustering threshold on purpose: a dedicated MT
 * model words things differently from an LLM even when it means the same, and
 * this only has to identify which of two candidates is nearer, not that the two
 * texts are interchangeable.
 */
export const ARBITER_MIN_SCORE = 0.45;

/**
 * How far the winner must lead the runner-up. Without it, 0.51 vs 0.50 would
 * "settle" a line the arbiter is genuinely undecided about — worse than leaving
 * it flagged, because it silently removes it from the review queue.
 */
export const ARBITER_MIN_MARGIN = 0.1;

/**
 * Decide which disputed candidate an arbiter's rendering supports.
 *
 * Returns a winner only when one candidate is both close enough to the arbiter
 * and clearly closer than the rest. Anything else leaves the line disputed —
 * this narrows the review queue, it does not replace it.
 */
export function arbitrateDispute(
  arbiterText: string | null | undefined,
  candidates: ArbiterCandidate[],
  opts: { minScore?: number; minMargin?: number } = {},
): Arbitration {
  const minScore = opts.minScore ?? ARBITER_MIN_SCORE;
  const minMargin = opts.minMargin ?? ARBITER_MIN_MARGIN;

  if (!arbiterText || !arbiterText.trim()) {
    return { winner: null, score: 0, margin: 0, reason: 'no_arbiter_text' };
  }
  const present = candidates.filter((c) => c.text && c.text.trim());
  if (present.length === 0) {
    return { winner: null, score: 0, margin: 0, reason: 'no_candidates' };
  }

  const scored = present
    .map((c) => ({ cand: c, score: jaccard(arbiterText, c.text) }))
    .sort((a, b) => b.score - a.score || b.cand.weight - a.cand.weight);

  const best = scored[0];
  const runnerUp = scored[1];
  const margin = runnerUp ? best.score - runnerUp.score : best.score;

  if (best.score < minScore) {
    return { winner: null, score: best.score, margin, reason: 'below_threshold' };
  }
  if (runnerUp && margin < minMargin) {
    return { winner: null, score: best.score, margin, reason: 'too_close' };
  }
  return { winner: best.cand, score: best.score, margin };
}
