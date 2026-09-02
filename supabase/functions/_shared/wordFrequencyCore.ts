// Pure half of derive-word-frequency (docs/language-learning-plan-2026-09.md,
// Phase 3). No IO, no Deno — src/test/wordFrequencyCore.test.ts runs it under
// Vitest.
//
// Why this exists: no frequency list for spoken Gulf, Egyptian or Yemeni
// Arabic is published anywhere (research §4, §10), and MSA frequency is the
// wrong ranking for a dialect learner — نافذة outranks شباك in every MSA
// dictionary and is the word nobody says. The only source of genuine dialect
// frequency this project has is its own transcripts: caption lines scored for
// dialectness, and the transcripts native reviewers have corrected. Counting
// those is what makes "teach the common words first" possible, and the
// retrieval-practice gain the SRS relies on was driven by high-frequency words
// (research §1).

import { normalizeArabic } from "./msaLeakDetector.ts";

/** One line of source text with the weight its provenance earns. */
export interface FrequencySource {
  text: string;
  /** Reviewed transcripts count for more than raw captions. */
  weight: number;
  /** Groups lines into documents for doc_count — a video id, typically. */
  doc: string;
}

export interface TokenStat {
  token: string;
  count: number;
  docCount: number;
}

export interface FrequencyRow extends TokenStat {
  dialect: string;
  /** Zipf scale: log10 of frequency per billion tokens; ~7 is "the", ~3 is rare. */
  zipf: number;
}

/** Default weights by provenance. */
export const CAPTION_WEIGHT = 1;
export const REVIEWED_WEIGHT = 3;

/**
 * Caption lines below this dialect_score are left out. dialect_score is the
 * density of the claimed dialect's markers in the line (dialectMarkers.ts);
 * "dialectal" corpora are often substantially MSA (research §5), so the filter
 * is by measured dialectness, not by the channel's label. Held as a parameter
 * so the job can tighten it once the table exists to compare against.
 */
export const DEFAULT_MIN_DIALECT_SCORE = 0.05;

const ARABIC_LETTER = /[ء-يٱ-ۓ]/;
const NON_LETTER = /[^ء-يٱ-ۓ]+/g;

/** Split into normalised Arabic tokens; Latin, digits and one-letter fragments drop. */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return normalizeArabic(text)
    .split(NON_LETTER)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && ARABIC_LETTER.test(t));
}

/**
 * The lookup keys a vocabulary entry can match under: itself, and itself with
 * the definite article and the waw-conjunction stripped — the two clitics
 * that most often hide a known word (comprehension.ts does the same).
 */
export function matchKeys(token: string): string[] {
  const keys = [token];
  if (token.startsWith("ال") && token.length > 3) keys.push(token.slice(2));
  if (token.startsWith("و") && token.length > 2) {
    keys.push(token.slice(1));
    if (token.startsWith("وال") && token.length > 4) keys.push(token.slice(3));
  }
  return keys;
}

/**
 * Weighted token and document counts over a set of lines.
 *
 * A token's count is the sum of its lines' weights; its docCount is the number
 * of distinct documents it appeared in, unweighted — "how many videos say
 * this" is a different fact from "how often", and both matter for ranking.
 */
export function countTokens(sources: FrequencySource[]): TokenStat[] {
  const counts = new Map<string, number>();
  const docs = new Map<string, Set<string>>();
  for (const src of sources) {
    if (!(src.weight > 0)) continue;
    for (const token of tokenize(src.text)) {
      counts.set(token, (counts.get(token) ?? 0) + src.weight);
      let d = docs.get(token);
      if (!d) { d = new Set(); docs.set(token, d); }
      d.add(src.doc);
    }
  }
  return [...counts.entries()]
    .map(([token, count]) => ({ token, count, docCount: docs.get(token)?.size ?? 0 }))
    .sort((a, b) => b.count - a.count || b.docCount - a.docCount || a.token.localeCompare(b.token));
}

/** Zipf value for a count within a corpus of `total` weighted tokens. */
export function zipf(count: number, total: number): number {
  if (!(count > 0) || !(total > 0)) return 0;
  return Math.round(Math.log10((count / total) * 1_000_000_000) * 100) / 100;
}

/** Table rows for one dialect. */
export function toFrequencyRows(dialect: string, stats: TokenStat[]): FrequencyRow[] {
  const total = stats.reduce((sum, s) => sum + s.count, 0);
  return stats.map((s) => ({ dialect, ...s, zipf: zipf(s.count, total) }));
}

export interface RankableEntry {
  id: string;
  arabic: string;
}

export interface RankedEntry {
  id: string;
  /** 1 = most frequent. null = never seen in the corpus. */
  frequencyRank: number | null;
  /** The corpus token it matched, for auditing. */
  matchedToken: string | null;
}

/**
 * Assign a rank to each vocabulary entry from its best-matching corpus token.
 *
 * A multi-word entry is ranked by its rarest content token: a phrase is only
 * as common as the word in it the learner is least likely to know. Ties keep
 * the corpus order. Entries with no match get null and sort last downstream —
 * absence from the corpus is information too ("nobody on our channels says
 * this"), not a reason to guess.
 */
export function rankEntries(entries: RankableEntry[], stats: TokenStat[]): RankedEntry[] {
  const rankOf = new Map<string, number>();
  stats.forEach((s, i) => { if (!rankOf.has(s.token)) rankOf.set(s.token, i + 1); });

  return entries.map((entry) => {
    const tokens = tokenize(entry.arabic);
    if (tokens.length === 0) return { id: entry.id, frequencyRank: null, matchedToken: null };

    let worst: { rank: number; token: string } | null = null;
    for (const token of tokens) {
      let best: { rank: number; token: string } | null = null;
      for (const key of matchKeys(token)) {
        const r = rankOf.get(key);
        if (r !== undefined && (best === null || r < best.rank)) best = { rank: r, token: key };
      }
      if (best === null) return { id: entry.id, frequencyRank: null, matchedToken: null };
      if (worst === null || best.rank > worst.rank) worst = best;
    }
    return { id: entry.id, frequencyRank: worst!.rank, matchedToken: worst!.token };
  });
}
