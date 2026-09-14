// =============================================================================
// Parsing Fanar's dialect-validation reply into structured issues.
//
// Fanar is asked for `{"issues": [...]}` and mostly obliges, but it is a 27B
// Arabic model writing JSON whose string values are Arabic prose, and it
// deviates in a handful of predictable ways. The parser this replaces did one
// strict `JSON.parse` over a first-brace-to-last-brace slice, so any of them
// dropped the whole reply to raw text — the last audit reported real MSA leaks
// (جل, تسري) correctly identified and then discarded as unstructured.
//
// Everything here is a *recovery* of well-formed intent, never a guess at
// content: if no issue array can be recovered the caller still gets null and
// keeps the raw text. The point is to stop losing answers Fanar did give.
// =============================================================================

export interface DialectIssue {
  line?: number;
  word?: string;
  kind?: string;
  severity?: 'low' | 'high';
  note?: string;
}

/** The four categories the prompt asks for. */
const KNOWN_KINDS = ['msa', 'spelling', 'foreign_dialect', 'cultural'] as const;

/**
 * Arabic labels Fanar substitutes for the English `kind` values it was given.
 * Asked to answer about Arabic in Arabic, it sometimes translates the enum too.
 */
const ARABIC_KIND: Record<string, string> = {
  'فصحى': 'msa',
  'الفصحى': 'msa',
  'فصيح': 'msa',
  'إملاء': 'spelling',
  'إملائي': 'spelling',
  'املائي': 'spelling',
  'تهجئة': 'spelling',
  'لهجة أخرى': 'foreign_dialect',
  'لهجة_أخرى': 'foreign_dialect',
  'لهجة': 'foreign_dialect',
  'ثقافي': 'cultural',
  'ثقافية': 'cultural',
};

/**
 * Arabic (and a few English variant) spellings of the *field names*. Asked in
 * Arabic to emit `line`/`word`/`kind`/`severity`/`note`, a smaller model —
 * Jais 2 8B on the last audited run — translates the keys as readily as the
 * values, and an object keyed `الكلمة`/`النوع` carried real findings that the
 * parser threw away as noise. Keys are normalised through this table before
 * anything is read off the object.
 */
const KEY_ALIASES: Record<string, keyof DialectIssue> = {
  'السطر': 'line', 'سطر': 'line', 'رقم_السطر': 'line', 'رقم السطر': 'line', 'line_number': 'line', 'lineno': 'line',
  'الكلمة': 'word', 'كلمة': 'word', 'العبارة': 'word', 'token': 'word', 'text': 'word', 'phrase': 'word',
  'النوع': 'kind', 'نوع': 'kind', 'التصنيف': 'kind', 'type': 'kind', 'category': 'kind', 'issue_type': 'kind',
  'الشدة': 'severity', 'شدة': 'severity', 'الخطورة': 'severity', 'الأهمية': 'severity', 'level': 'severity',
  'ملاحظة': 'note', 'الملاحظة': 'note', 'شرح': 'note', 'الشرح': 'note', 'تعليق': 'note', 'التعليق': 'note',
  'reason': 'note', 'explanation': 'note', 'comment': 'note', 'suggestion': 'note',
};

/** `{"الكلمة": …}` → `{word: …}`; keys already in English pass through. */
function normalizeIssueKeys(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    const lower = key.trim().toLowerCase();
    const mapped = KEY_ALIASES[key.trim()] ?? KEY_ALIASES[lower] ?? lower;
    if (!(mapped in out)) out[mapped] = v;
  }
  return out;
}

const ARABIC_SEVERITY: Record<string, 'low' | 'high'> = {
  'عالية': 'high',
  'عالي': 'high',
  'مرتفعة': 'high',
  'كبيرة': 'high',
  'منخفضة': 'low',
  'منخفض': 'low',
  'بسيطة': 'low',
  'صغيرة': 'low',
};

/** Arabic-Indic and extended Arabic-Indic digits → ASCII. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

/**
 * Pull out every balanced `{...}` or `[...]` region, longest first.
 *
 * The first-brace-to-last-brace slice this replaces breaks on a reply that puts
 * prose containing a brace either side of the JSON, and on a reply that answers
 * with a bare array. Scanning for balance finds the real payload in both.
 * Brace counting ignores anything inside a JSON string so a `}` in an Arabic
 * note cannot close the object early.
 */
export function extractJsonCandidates(text: string): string[] {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '');

  const found: string[] = [];
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] !== open) continue;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let j = i; j < cleaned.length; j++) {
        const ch = cleaned[j];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === open) depth++;
        else if (ch === close) {
          depth--;
          if (depth === 0) { found.push(cleaned.slice(i, j + 1)); break; }
        }
      }
    }
  }
  return found.sort((a, b) => b.length - a.length);
}

/**
 * JSON.parse, then parse again after repairing the faults a model actually
 * emits. Each repair is shape-only — trailing commas, smart quotes, Arabic
 * digits in numeric slots — so nothing is invented that Fanar didn't write.
 */
export function tolerantJsonParse(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch { /* fall through to repairs */ }

  let repaired = normalizeDigits(candidate)
    // Smart quotes around keys and values.
    .replace(/[“”„«»]/g, '"')
    .replace(/[‘’]/g, "'");
  // Python-style JSON: single quotes throughout and not a double quote in
  // sight. Only then — an apostrophe inside a double-quoted note is data.
  if (!repaired.includes('"') && repaired.includes("'")) repaired = repaired.replace(/'/g, '"');
  repaired = repaired
    // Trailing comma before a close brace/bracket.
    .replace(/,(\s*[}\]])/g, '$1')
    // An Arabic comma used as a JSON separator, but only where a structural
    // comma could legally sit — between a close and the next key or value.
    .replace(/([}\]"])\s*،\s*(["{[])/g, '$1,$2');

  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

/** Does this look like one of Fanar's issue objects rather than some other record? */
function isIssueShaped(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const o = normalizeIssueKeys(value as Record<string, unknown>);
  return ['word', 'kind', 'note', 'severity', 'line'].some((k) => k in o);
}

/**
 * Locate the issues array inside whatever shape came back.
 *
 * Accepts the requested `{issues: [...]}`, a bare `[...]`, and a wrapper such as
 * `{result: {issues: [...]}}` — all of which Fanar has produced for a prompt
 * that asked for the first.
 */
export function findIssuesArray(parsed: unknown, depth = 0): unknown[] | null {
  if (depth > 4 || parsed == null) return null;
  if (Array.isArray(parsed)) {
    return parsed.some(isIssueShaped) || parsed.length === 0 ? parsed : null;
  }
  if (typeof parsed !== 'object') return null;

  const o = parsed as Record<string, unknown>;
  if (Array.isArray(o.issues)) return o.issues;
  for (const value of Object.values(o)) {
    const nested = findIssuesArray(value, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function coerceLine(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    // "3", "٣", and "السطر 3" all mean line 3.
    const match = normalizeDigits(value).match(/\d+/);
    if (match) return Number(match[0]);
  }
  return undefined;
}

function coerceKind(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const raw = value.trim();
  const lower = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if ((KNOWN_KINDS as readonly string[]).includes(lower)) return lower;
  return ARABIC_KIND[raw] ?? raw.slice(0, 32);
}

function coerceSeverity(value: unknown): 'low' | 'high' {
  if (typeof value !== 'string') return 'low';
  const raw = value.trim();
  if (raw.toLowerCase() === 'high') return 'high';
  return ARABIC_SEVERITY[raw] ?? 'low';
}

/**
 * Parse Fanar's validation reply into issues.
 *
 * Returns null only when no issue array could be recovered at all — callers
 * fall back to keeping the raw text, so the signal degrades rather than
 * disappearing. An empty array is a real answer meaning "no problems found",
 * and is deliberately distinct from null.
 */
export function parseDialectIssues(content: string): DialectIssue[] | null {
  if (!content || !content.trim()) return null;

  for (const candidate of extractJsonCandidates(content)) {
    const parsed = tolerantJsonParse(candidate);
    const raw = findIssuesArray(parsed);
    if (!raw) continue;

    const issues = coerceIssues(raw);

    // A candidate that parsed to an array of pure noise is not the answer;
    // keep scanning the smaller candidates before giving up.
    if (issues.length > 0 || raw.length === 0) return issues;
  }

  // No array anywhere — but a reply cut off by its token budget still holds
  // every issue object that was finished before the cut, each of them a
  // balanced `{...}` the scanner already found. A truncated list of real
  // findings is a real answer; the old first-brace-to-last-brace parse and
  // then the array-only recovery both discarded it whole.
  const salvaged = coerceIssues(
    extractJsonCandidates(content)
      .map(tolerantJsonParse)
      .filter((value) => isIssueShaped(value)),
  );
  if (salvaged.length > 0) return salvaged;

  return null;
}

/** Issue objects → `DialectIssue`s, dropping anything that carries none of the fields. */
function coerceIssues(raw: unknown[]): DialectIssue[] {
  return raw.flatMap((item): DialectIssue[] => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const o = normalizeIssueKeys(item as Record<string, unknown>);
      const line = coerceLine(o.line);
      const kind = coerceKind(o.kind);
      const word = typeof o.word === 'string' && o.word.trim()
        ? o.word.trim().slice(0, 80)
        : undefined;
      const note = typeof o.note === 'string' && o.note.trim()
        ? o.note.trim().slice(0, 200)
        : undefined;
      // An object carrying none of the fields is noise, not an issue.
      if (line === undefined && !kind && !word && !note) return [];
      return [{
        ...(line !== undefined ? { line } : {}),
        ...(word ? { word } : {}),
        ...(kind ? { kind } : {}),
        severity: coerceSeverity(o.severity),
        ...(note ? { note } : {}),
      }];
    });
}
