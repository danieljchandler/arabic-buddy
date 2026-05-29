// MSA (Modern Standard Arabic) leak detector.
// V1: hardcoded forbidden tokens per dialect. V2 will read from the dialect_rules table.

import type { Dialect } from './dialectHelpers.ts';

// Words that strongly signal MSA in any spoken-dialect context.
const UNIVERSAL_MSA_LEAKS = [
  'الآن', // now -> dialect: هالحين / دلوقتي / ذحين
  'لماذا', // why -> ليش / ليه
  'كيف', // how -> شلون / إزاي (often acceptable in YEM/EGY too — soft)
  'أين', // where -> وين / فين
  'ماذا', // what -> شو / إيش / إيه
  'هذا', // this -> ها / ده
  'هذه', // this(f) -> هاي / دي
  'هؤلاء',
  'ذلك',
  'سوف', // future -> ح / راح
  'ليس', // -> مو / مش / ما
  'لست',
  'ليسوا',
  'يريد', // -> يبي / عايز / بغى
  'تريد',
  'نريد',
  'أريد',
  'كثير', // -> واجد / كتير
  'قليل',
  'الذي',
  'التي',
  'الذين',
  'عندما',
  'حينما',
  'بينما',
  'أيضاً',
  'أيضًا',
  'كذلك',
];

// Dialect-specific extra leaks (words that are fine in MSA but wrong cross-dialect).
const DIALECT_EXTRA: Record<string, string[]> = {
  Gulf: [
    'إزيك', 'إزاي', 'دلوقتي', 'عايز', 'عاوز', 'كده', 'ده', 'دي', 'كويس', // Egyptian
    'مفيش',
  ],
  Egyptian: [
    'شلونك', 'هالحين', 'واجد', 'يبي', 'إمبي', 'زين', 'خوش', // Gulf
    'بغيت', 'ذحين', 'قات', 'مفرج', // Yemeni
  ],
  Yemeni: [
    'إزيك', 'دلوقتي', 'عايز', 'كده', // Egyptian
    'هالحين', 'واجد', 'يبي', 'خوش', // Gulf
  ],
};

export interface MsaLeakResult {
  leaks: string[]; // unique offending tokens
  severity: 'none' | 'low' | 'medium' | 'high';
}

export function detectMsaLeaks(text: string, dialect: Dialect): MsaLeakResult {
  if (!text) return { leaks: [], severity: 'none' };
  const extra = DIALECT_EXTRA[dialect] ?? [];
  const wordlist = [...UNIVERSAL_MSA_LEAKS, ...extra];
  const found = new Set<string>();
  for (const w of wordlist) {
    // word-boundary-ish match for Arabic (whitespace, punctuation, line edges)
    const re = new RegExp(`(^|[\\s\\p{P}])${escapeRe(w)}($|[\\s\\p{P}])`, 'u');
    if (re.test(text)) found.add(w);
  }
  const leaks = [...found];
  let severity: MsaLeakResult['severity'] = 'none';
  if (leaks.length === 1) severity = 'low';
  else if (leaks.length === 2) severity = 'medium';
  else if (leaks.length >= 3) severity = 'high';
  return { leaks, severity };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
