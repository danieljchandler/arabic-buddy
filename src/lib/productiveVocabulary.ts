/**
 * Productive vocabulary from what the learner actually said.
 *
 * One of the two instruments the Duolingo efficacy study used that Hakiya
 * can run from data it already holds (docs/language-learning-research-
 * 2026-09.md §6): the number of distinct words (types) and total words
 * (tokens) a learner produces in free speech. Monologue attempts carry a
 * transcript, so the measure costs nothing new — and it is a *proficiency*
 * number, where the analytics page had only activity numbers.
 *
 * Pure. Tokenisation reuses the comprehension module's, so a "word" here
 * is the same thing it is everywhere else in the app.
 */
import { tokenizeArabic } from "@/lib/comprehension";

export interface AttemptLike {
  transcript: string | null;
  created_at: string;
  dialect?: string | null;
}

export interface ProductivePoint {
  at: string;
  tokens: number;
  types: number;
  /** Distinct words per word spoken; 1 = no repetition at all. */
  typeTokenRatio: number;
}

export interface ProductiveSummary {
  points: ProductivePoint[];
  /** Distinct words across every attempt — the learner's spoken vocabulary as observed. */
  cumulativeTypes: number;
  /** Mean types per attempt over the latest window, and the window before it. */
  recentMeanTypes: number | null;
  previousMeanTypes: number | null;
}

/** Attempts below this many tokens say nothing about vocabulary. */
export const MIN_TOKENS = 8;
/** Attempts per comparison window. */
export const WINDOW = 5;

export function attemptPoint(attempt: AttemptLike): ProductivePoint | null {
  const tokens = tokenizeArabic(attempt.transcript ?? "");
  if (tokens.length < MIN_TOKENS) return null;
  const types = new Set(tokens).size;
  return { at: attempt.created_at, tokens: tokens.length, types, typeTokenRatio: types / tokens.length };
}

export function summarize(attempts: AttemptLike[]): ProductiveSummary {
  const sorted = [...attempts].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const all = new Set<string>();
  const points: ProductivePoint[] = [];
  for (const attempt of sorted) {
    const point = attemptPoint(attempt);
    if (!point) continue;
    for (const t of tokenizeArabic(attempt.transcript ?? "")) all.add(t);
    points.push(point);
  }
  const mean = (xs: ProductivePoint[]) => (xs.length ? xs.reduce((s, p) => s + p.types, 0) / xs.length : null);
  const recent = points.slice(-WINDOW);
  const previous = points.slice(-2 * WINDOW, -WINDOW);
  return {
    points,
    cumulativeTypes: all.size,
    recentMeanTypes: mean(recent),
    previousMeanTypes: previous.length >= WINDOW ? mean(previous) : null,
  };
}
