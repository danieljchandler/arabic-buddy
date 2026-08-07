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
  /**
   * How the winner was chosen.
   * `nearest` — the arbiter is clearly closer to this candidate than the rest.
   * `corroborated` — the arbiter backs several candidates comparably well, so
   *   the line is not a quality risk and the highest-weight model takes it.
   */
  mode?: 'nearest' | 'corroborated';
  /** Why no winner was chosen, for provenance. */
  reason?: 'no_arbiter_text' | 'no_candidates' | 'below_threshold';
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
 * How far the winner must lead the runner-up to be called the *nearest* match.
 * Below this the arbiter is not discriminating between them — which is a
 * separate question from whether either is any good; see `corroborated`.
 */
export const ARBITER_MIN_MARGIN = 0.1;

/**
 * Decide which disputed candidate an arbiter's rendering supports.
 *
 * Two ways a line can be settled, and the second exists because the first
 * settled nothing in practice. A run with eight disputed lines produced best
 * scores of 0.24-0.69 against margins of 0.01-0.14: the arbiter was repeatedly
 * *equally* close to two candidates, so requiring a clear margin left every line
 * in the review queue.
 *
 * A near-tie is not evidence of a problem. Candidates only reach arbitration
 * because they failed the ensemble's own 0.6 clustering bar, so they are
 * genuinely different wordings — but an independent Arabic-native MT model
 * landing close to *both* is positive evidence that both convey the same thing.
 * The review queue is for lines where the models disagree about meaning, not for
 * choosing between two renderings that a third model corroborates. So when every
 * leading candidate clears `minScore`, the line is settled on model weight and
 * marked `corroborated`; when the arbiter backs none of them, it stays flagged.
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

  // The arbiter backs nothing here — a real disagreement, keep it flagged.
  if (best.score < minScore) {
    return { winner: null, score: best.score, margin, reason: 'below_threshold' };
  }

  // Clearly nearer to one candidate than the rest.
  if (!runnerUp || margin >= minMargin) {
    return { winner: best.cand, score: best.score, margin, mode: 'nearest' };
  }

  // Too close to call, but both are backed. Take the higher-weight model —
  // `scored` already breaks score ties that way.
  const corroborated = scored
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.cand.weight - a.cand.weight || b.score - a.score)[0];
  return { winner: corroborated.cand, score: best.score, margin, mode: 'corroborated' };
}
