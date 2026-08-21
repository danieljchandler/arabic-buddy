/**
 * arabicMatch — normalising and comparing Arabic strings for scoring.
 *
 * Every voice scorer in the app compares what ASR heard against what the
 * learner was asked to say, and each one first has to throw away the
 * differences a speaker cannot produce and a microphone cannot capture:
 * tashkeel the reference carries and ASR never emits, hamza seats, ta marbuta
 * vs. ha, alef maqsura vs. ya, tatweel. Comparing raw strings scores a
 * word-perfect take at roughly half.
 *
 * The logic lived twice, copied into `score-shadow-attempt` and
 * `score-set-phrase-voice`, and the copies had drifted: the shadow copy wrote
 * its diacritic class with literal characters, which made the first range run
 * from fathatan all the way to the superscript alef — straight through the
 * Arabic-Indic digits — so it deleted every numeral before comparing. Spelling
 * the ranges out as numbers is why that is now visible rather than hidden
 * inside a regex literal nobody can read.
 *
 * Pure — no I/O, no Deno APIs.
 */

/**
 * Combining marks: vowelling a learner cannot pronounce differently and
 * Quranic annotation a microphone never captures. Stated as code-point ranges
 * so the boundaries are legible and the digit block (U+0660–U+0669) is
 * demonstrably outside them.
 */
const DIACRITIC_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0610, 0x061a], // Arabic honorific signs
  [0x064b, 0x065f], // tashkeel: fathatan through the wavy hamza below
  [0x0670, 0x0670], // superscript alef
  [0x06d6, 0x06ed], // Quranic annotation
];

function isDiacritic(cp: number): boolean {
  for (const [lo, hi] of DIACRITIC_RANGES) if (cp >= lo && cp <= hi) return true;
  return false;
}

/**
 * Letters that differ on the page but not in the mouth. ASR picks whichever
 * spelling its training data preferred, so a take is marked wrong for an
 * orthographic reason the learner has no way to act on unless these fold.
 */
const FOLD: Readonly<Record<string, string>> = {
  "\u0622": "\u0627", // alef madda   -> alef
  "\u0623": "\u0627", // alef hamza above -> alef
  "\u0625": "\u0627", // alef hamza below -> alef
  "\u0649": "\u064A", // alef maqsura -> ya
  "\u0629": "\u0647", // ta marbuta   -> ha
  "\u0624": "\u0648", // hamza on waw -> waw
  "\u0626": "\u064A", // hamza on ya  -> ya
};

/** Characters that carry no sound at all: tatweel, standalone hamza, punctuation. */
const DROP: ReadonlySet<string> = new Set([
  "\u0640", // tatweel (kashida) — a typographic stretch
  "\u0621", // standalone hamza
  "\u060C", "\u061B", "\u061F", // Arabic comma, semicolon, question mark
  ".", ",", "!", "?", '"', "'", "(", ")", "[", "]", "{", "}", "\u00AB", "\u00BB",
]);

/**
 * Strip the marks a learner cannot pronounce differently and fold the letter
 * variants a speaker does not distinguish, so two spellings of the same spoken
 * word compare equal.
 */
export function normalizeArabic(s: string): string {
  if (!s) return "";
  let out = "";
  for (const ch of s) {
    if (isDiacritic(ch.codePointAt(0) ?? 0)) continue;
    if (DROP.has(ch)) continue;
    out += FOLD[ch] ?? ch;
  }
  return out.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array(b.length + 1);
  const v1 = new Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}

/**
 * Character-level normalised similarity (0..1) between two Arabic strings.
 *
 * Two empty strings match; one empty string against a real one does not — an
 * empty transcription is "we did not hear you", and it must not fall out of the
 * maths as a perfect match.
 */
export function arabicSimilarity(a: string, b: string): number {
  const na = normalizeArabic(a);
  const nb = normalizeArabic(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}
