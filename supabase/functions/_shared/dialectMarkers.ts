// Dialect marker scorer for the clip pipeline.
//
// msaLeakDetector answers "does this dialect text contain MSA?" — this module
// answers the inverse question the caption index needs: "which dialect is this
// text?". Content words are shared across dialects (كلب is everyone's dog), so
// classification rests on closed-class function words: دلوقتي is Egyptian,
// وايد is Gulf, ذحين is Yemeni, سوف is MSA.
//
// The lists are deliberately conservative and three-tiered, because the
// overlap between Gulf and Yemeni is real (شلون, وش, زين are valid in both —
// see the ALWAYS_ALLOWED audit in msaLeakDetector):
//
//   EXCLUSIVE  a form that identifies one dialect (full weight)
//   SHARED     a form valid in a known set of dialects (weight split)
//   GENERAL    pan-dialect colloquial forms (بس, اللي, مش...) — evidence the
//              text is dialect rather than MSA, but not which dialect
//
// Scores are advisory 0..1 densities, not probabilities. They rank candidates
// and gate automation tiers; a human or a downstream verifier owns anything
// borderline. All matching runs on normalizeArabic'd text so the scorer can
// never disagree with the rest of the app about what counts as the same word.

import { normalizeArabic } from './msaLeakDetector.ts';

export type MarkerDialect = 'Gulf' | 'Egyptian' | 'Yemeni';

const DIALECTS: MarkerDialect[] = ['Gulf', 'Egyptian', 'Yemeni'];

// ---------- marker lists ----------
//
// Sources: the msaLeakDetector whitelists and their 2026-06/08 audits, the
// Lisan Yemeni corpus counts recorded there, and the dialect-ID literature's
// canonical Egyptian cues (Darwish et al. 2014). Rules of admission:
//   - a form goes in EXCLUSIVE only if the other two dialects' whitelists and
//     corpora don't attest it;
//   - anything attested in two dialects goes in SHARED for exactly those two;
//   - ambiguous-with-MSA forms (e.g. ابي "I want" vs أبي "my father") are
//     left out entirely — a scorer that guesses is worse than one that
//     abstains.

const EXCLUSIVE: Record<MarkerDialect, string[]> = {
  Egyptian: [
    'دلوقتي', 'النهارده', 'امبارح', 'ازاي', 'ازيك', 'ازيكو',
    'عايز', 'عاوز', 'عايزه', 'مفيش', 'كده', 'كدا', 'بتاع', 'بتاعه',
    'اهو', 'اهي', 'يعني ايه', 'ليه', 'دي', 'ده',
  ],
  Gulf: [
    'وايد', 'شخبارك', 'شخبارش', 'شخباركم', 'هالحين', 'خوش',
    'يبي', 'تبي', 'ابيك', 'وش رايك', 'چذي', 'شفيك انت',
  ],
  Yemeni: [
    'ذحين', 'ذلحين', 'اشتي', 'تشتي', 'يشتي', 'لاحين',
    'ما شي', 'قات', 'مفرج', 'جنبيه',
  ],
};

// Forms attested in more than one dialect: weight splits evenly across the
// listed dialects. Keys are display forms; membership is the audited fact.
const SHARED: Array<{ token: string; dialects: MarkerDialect[] }> = [
  { token: 'شلون', dialects: ['Gulf', 'Yemeni'] },
  { token: 'شلونك', dialects: ['Gulf', 'Yemeni'] },
  { token: 'وش', dialects: ['Gulf', 'Yemeni'] },
  { token: 'زين', dialects: ['Gulf', 'Yemeni'] },
  { token: 'ابغى', dialects: ['Gulf', 'Yemeni'] },
  { token: 'يبغى', dialects: ['Gulf', 'Yemeni'] },
  { token: 'بغيت', dialects: ['Gulf', 'Yemeni'] },
  { token: 'الحين', dialects: ['Gulf', 'Yemeni'] },
  { token: 'وين', dialects: ['Gulf', 'Yemeni'] },
  { token: 'ليش', dialects: ['Gulf', 'Yemeni'] },
  { token: 'عاد', dialects: ['Gulf', 'Yemeni'] },
  { token: 'مو', dialects: ['Gulf', 'Yemeni'] },
  { token: 'شفيك', dialects: ['Gulf', 'Yemeni'] },
  { token: 'مش', dialects: ['Egyptian', 'Yemeni'] },
  { token: 'فين', dialects: ['Egyptian', 'Yemeni'] },
  { token: 'معلش', dialects: ['Egyptian', 'Gulf'] },
];

// Pan-dialect colloquial: raises "this is dialect" without pointing anywhere.
const GENERAL = [
  'بس', 'اللي', 'عشان', 'شوي', 'شويه', 'يلا', 'زي', 'طيب', 'خلاص',
  'ايش', 'ايوه', 'اوكي', 'حق', 'كمان',
];

// MSA markers. هذا/هذه/عندما are deliberately absent: the 2026-08 audits
// found them ordinary in Gulf and Yemeni speech, and a scorer that penalizes
// them would mark half the Khaliji corpus as MSA.
const MSA = [
  'الان', 'لماذا', 'ماذا', 'سوف', 'ليس', 'ليست', 'لست', 'ليسوا',
  'الذي', 'التي', 'الذين', 'حينما', 'بينما', 'ايضا', 'كذلك',
  'يجب', 'حيث', 'قد يكون', 'ان شاء الله تعالى',
];

// ---------- compiled form ----------

interface CompiledMarker {
  norm: string;
  display: string;
  // weight this marker contributes to each class it belongs to
  weights: Partial<Record<MarkerDialect | 'msa' | 'general', number>>;
}

function compile(): CompiledMarker[] {
  const out: CompiledMarker[] = [];
  for (const d of DIALECTS) {
    for (const t of EXCLUSIVE[d]) {
      out.push({ norm: normalizeArabic(t), display: t, weights: { [d]: 1 } });
    }
  }
  for (const { token, dialects } of SHARED) {
    const w = 1 / dialects.length;
    const weights: CompiledMarker['weights'] = {};
    for (const d of dialects) weights[d] = w;
    out.push({ norm: normalizeArabic(token), display: token, weights });
  }
  for (const t of GENERAL) {
    out.push({ norm: normalizeArabic(t), display: t, weights: { general: 1 } });
  }
  for (const t of MSA) {
    out.push({ norm: normalizeArabic(t), display: t, weights: { msa: 1 } });
  }
  return out.filter((m) => m.norm.length > 0);
}

const MARKERS = compile();

// One marker per ~6 tokens saturates the density scale. Short caption lines
// (5-8 tokens) with a single strong marker land around 0.75-1.0, which is the
// behaviour we want: one وايد in a 6-word line is strong evidence.
const DENSITY_SCALE = 6;

export interface MarkerScore {
  /** 0..1 per-dialect marker density (scaled, capped). */
  dialectScores: Record<MarkerDialect, number>;
  /** 0..1 MSA marker density (scaled, capped). */
  msaScore: number;
  /** 0..1 pan-dialect colloquial density — dialectness without direction. */
  generalScore: number;
  /** Display forms of matched markers, per class. */
  hits: Partial<Record<MarkerDialect | 'msa' | 'general', string[]>>;
  /** Whitespace token count of the normalized text. */
  tokenCount: number;
  /**
   * Best dialect guess, or 'MSA' when MSA markers dominate, or null when the
   * text carries no directional evidence at all (a bare كلب! is null: the
   * word is everyone's).
   */
  best: MarkerDialect | 'MSA' | null;
  /**
   * 0..1 separation of best from runner-up. A شلونك-only line is Gulf/Yemeni
   * tied: best is set but confidence is 0. Automation tiers should gate on
   * confidence, not on best alone.
   */
  confidence: number;
}

function matchCount(stripped: string, norm: string): number {
  // Word-boundary matching, phrase-safe (multi-word markers contain spaces).
  const re = new RegExp(
    `(^|[\\s\\p{P}])${escapeRe(norm)}($|[\\s\\p{P}])`,
    'gu',
  );
  let n = 0;
  while (re.exec(stripped) !== null) {
    n += 1;
    // Zero-width protection: lastIndex sits after the trailing boundary, and
    // adjacent matches share it, so step back one to not skip a neighbour.
    re.lastIndex = Math.max(re.lastIndex - 1, 0);
  }
  return n;
}

export function scoreDialectMarkers(text: string): MarkerScore {
  const stripped = normalizeArabic(text ?? '');
  const tokenCount = stripped ? stripped.split(/\s+/).length : 0;

  const raw: Record<MarkerDialect | 'msa' | 'general', number> = {
    Gulf: 0, Egyptian: 0, Yemeni: 0, msa: 0, general: 0,
  };
  const hits: MarkerScore['hits'] = {};

  if (tokenCount > 0) {
    for (const marker of MARKERS) {
      const n = matchCount(stripped, marker.norm);
      if (n === 0) continue;
      for (const [cls, w] of Object.entries(marker.weights)) {
        const key = cls as MarkerDialect | 'msa' | 'general';
        raw[key] += n * (w as number);
        (hits[key] ??= []).push(marker.display);
      }
    }
  }

  const density = (weighted: number) =>
    tokenCount === 0 ? 0 : Math.min(1, (weighted * DENSITY_SCALE) / tokenCount);

  const dialectScores: Record<MarkerDialect, number> = {
    Gulf: density(raw.Gulf),
    Egyptian: density(raw.Egyptian),
    Yemeni: density(raw.Yemeni),
  };
  const msaScore = density(raw.msa);
  const generalScore = density(raw.general);

  const ranked = DIALECTS
    .map((d) => ({ d, s: dialectScores[d] }))
    .sort((a, b) => b.s - a.s);
  const top = ranked[0];
  const second = ranked[1];

  let best: MarkerScore['best'] = null;
  let confidence = 0;
  if (msaScore > top.s && msaScore > 0) {
    best = 'MSA';
    confidence = top.s === 0 ? 1 : Math.min(1, (msaScore - top.s) / msaScore);
  } else if (top.s > 0) {
    best = top.d;
    confidence = Math.min(1, (top.s - second.s) / top.s);
  }

  return { dialectScores, msaScore, generalScore, hits, tokenCount, best, confidence };
}

/**
 * Convenience for the caption index: the two numbers a caption_lines row
 * stores. dialect_score is the density for the channel's claimed dialect —
 * shared Gulf/Yemeni markers count for the claimed side at their split
 * weight, so a Yemeni channel's شلونك still scores as Yemeni evidence.
 */
export function scoreLineForDialect(
  text: string,
  dialect: MarkerDialect,
): { dialectScore: number; msaScore: number } {
  const s = scoreDialectMarkers(text);
  return { dialectScore: s.dialectScores[dialect], msaScore: s.msaScore };
}

/**
 * Token-weighted rollup for channel vetting: many short lines shouldn't
 * outvote a few long ones. Returns the claimed dialect's aggregate density,
 * the aggregate MSA contamination, and how much of the corpus carried any
 * directional evidence contradicting the claim (misfitShare — lines whose
 * best guess was a *different* dialect or MSA with real confidence).
 */
export function aggregateChannelScores(
  lines: string[],
  claimed: MarkerDialect,
): { dialectScore: number; msaScore: number; misfitShare: number; lineCount: number } {
  let tokenTotal = 0;
  let dialectWeighted = 0;
  let msaWeighted = 0;
  let misfits = 0;
  let judged = 0;

  for (const line of lines) {
    const s = scoreDialectMarkers(line);
    if (s.tokenCount === 0) continue;
    tokenTotal += s.tokenCount;
    dialectWeighted += s.dialectScores[claimed] * s.tokenCount;
    msaWeighted += s.msaScore * s.tokenCount;
    if (s.best !== null) {
      judged += 1;
      if (s.best !== claimed && s.confidence >= 0.5) misfits += 1;
    }
  }

  return {
    dialectScore: tokenTotal === 0 ? 0 : dialectWeighted / tokenTotal,
    msaScore: tokenTotal === 0 ? 0 : msaWeighted / tokenTotal,
    misfitShare: judged === 0 ? 0 : misfits / judged,
    lineCount: lines.length,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
