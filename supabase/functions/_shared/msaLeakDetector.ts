// MSA (Modern Standard Arabic) leak detector.
// Combines a hardcoded universal/cross-dialect list with rulebook-derived
// forbidden tokens harvested from approved dialect_rules.examples.bad
// (see primeDialectPrompt in dialectHelpers.ts).

import type { Dialect } from './dialectHelpers.ts';

// Note: كيف is excluded from universal leaks because it is legitimate in Yemeni
// dialect (كيف حالك). It's handled per-dialect in DIALECT_EXTRA instead.
const UNIVERSAL_MSA_LEAKS = [
  'الآن', 'لماذا', 'أين', 'ماذا', 'هذا', 'هذه', 'هؤلاء', 'ذلك',
  'سوف', 'ليس', 'لست', 'ليسوا', 'يريد', 'تريد', 'نريد', 'أريد',
  'كثير', 'قليل', 'الذي', 'التي', 'الذين',
  'عندما', 'حينما', 'بينما', 'أيضاً', 'أيضًا', 'كذلك',
];

const DIALECT_EXTRA: Record<string, string[]> = {
  Gulf: ['إزيك', 'إزاي', 'دلوقتي', 'عايز', 'عاوز', 'كده', 'ده', 'دي', 'كويس', 'مفيش', 'كيف'],
  Egyptian: ['شلونك', 'هالحين', 'واجد', 'يبي', 'إمبي', 'زين', 'خوش', 'بغيت', 'ذحين', 'كيف'],
  Yemeni: ['إزيك', 'دلوقتي', 'عايز', 'كده', 'هالحين', 'واجد', 'يبي', 'خوش', 'شلون', 'شلونك', 'شخبارك', 'شخبارش', 'يبغى', 'أبغى', 'أبي', 'وش', 'شفيك', 'زين', 'مرة', 'لاحين'],
};

export interface MsaLeakResult {
  leaks: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
  /** token → rule_id (only present when leak matched a rulebook-derived token) */
  ruleHits?: Record<string, string>;
}

export interface ExtraToken {
  token: string;
  rule_id?: string;
}

export function detectMsaLeaks(
  text: string,
  dialect: Dialect,
  extraTokens: ExtraToken[] = [],
): MsaLeakResult {
  if (!text) return { leaks: [], severity: 'none' };
  const extra = DIALECT_EXTRA[dialect] ?? [];

  // Strip quoted/example content so we don't false-positive on contrastive examples.
  // This handles common patterns like "X (not Y)" or «quoted» or "quoted" tokens.
  const strippedText = text
    .replace(/[""«»][^""«»]*[""«»]/g, ' ')
    .replace(/\(not [^)]*\)/g, ' ')
    .replace(/\(بدل [^)]*\)/g, ' ')
    .replace(/❌[^\n✅]*/g, ' ')
    .replace(/AVOID[^\n]*/g, ' ');

  // Build candidate set with optional rule_id mapping.
  const candidates = new Map<string, string | undefined>();
  for (const w of UNIVERSAL_MSA_LEAKS) candidates.set(w, undefined);
  for (const w of extra) candidates.set(w, undefined);
  for (const { token, rule_id } of extraTokens) {
    if (!token) continue;
    const t = String(token).trim();
    if (!t) continue;
    // Don't overwrite a rule_id that's already set
    if (!candidates.has(t) || !candidates.get(t)) candidates.set(t, rule_id);
  }

  const found = new Set<string>();
  const ruleHits: Record<string, string> = {};
  for (const [w, ruleId] of candidates) {
    const re = new RegExp(`(^|[\\s\\p{P}])${escapeRe(w)}($|[\\s\\p{P}])`, 'u');
    if (re.test(strippedText)) {
      found.add(w);
      if (ruleId) ruleHits[w] = ruleId;
    }
  }
  const leaks = [...found];
  let severity: MsaLeakResult['severity'] = 'none';
  if (leaks.length === 1) severity = 'low';
  else if (leaks.length === 2) severity = 'medium';
  else if (leaks.length >= 3) severity = 'high';
  return { leaks, severity, ruleHits: Object.keys(ruleHits).length ? ruleHits : undefined };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
