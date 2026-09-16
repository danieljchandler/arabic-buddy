// =============================================================================
// NATIVE ARABIC REVIEW — the pure half.
// =============================================================================
//
// The Ask AI chat streams. That is what makes its Arabic the only learner-facing
// Arabic in the app that nothing checks: `askBrain` can run a repair pass and an
// optional native-speaker validator *before* it ships a draft, but a stream has
// already been read by the time anyone could judge it. `streamBrain`'s MSA-leak
// repair looks like the missing gate and is not — its corrected text only ever
// reached `onComplete` (assistant-chat's memory rewrite), never the learner, who
// watched the leaky text arrive token by token.
//
// So the check here runs *after* the answer, and its output is a visible note
// rather than a silent rewrite: "a native speaker would say X here". That shape
// is what makes it affordable — it is off the critical path, it degrades to
// nothing, and it is the one job an Arabic-native model is straightforwardly
// better at than the generalist writing the English around it.
//
// This module is imported verbatim by the browser as well as the edge function
// (like `pageContextCore.ts`), so it stays free of `Deno` and `fetch`. The
// impure half — which model is asked, and how — is `arabicReview.ts`.

import { normalizeArabic } from './msaLeakDetector.ts';

/** Arabic script, including the supplements and the presentation forms. */
const ARABIC_CHAR = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
/** Punctuation and whitespace that sit *inside* a run without ending it. */
const RUN_GLUE = "\\s\\u0640\\u060C\\u061B\\u061F!؟.,:;\\-–—'\"()\\[\\]«»";

const ARABIC_RUN = new RegExp(`[${ARABIC_CHAR}][${ARABIC_CHAR}${RUN_GLUE}]*`, "g");
const HAS_ARABIC = new RegExp(`[${ARABIC_CHAR}]`);
/**
 * Glue at the ends of a run, which is not glue at all.
 *
 * The same characters have to sit inside the pattern and off its edges: a run
 * must survive `شلونك، شخبارك` without splitting in two, and must not come back
 * as `شلونك (` out of `شلونك (shlonak)` — the bracket introduces the
 * transliteration, it is not part of the Arabic. Arabic-block punctuation (، ؟)
 * is kept where it falls, being as much a part of the line as the letters.
 */
const RUN_EDGE = new RegExp(`^[^${ARABIC_CHAR}]+|[^${ARABIC_CHAR}]+$`, "g");

/** True when `text` carries any Arabic script at all. The cheap pre-filter. */
export function containsArabic(text: string): boolean {
  return HAS_ARABIC.test(text);
}

/**
 * Every run of Arabic script in `text`, in order, trimmed of glue characters.
 *
 * Markdown is left alone deliberately: `**كلمة**` yields `كلمة` because the
 * asterisks are not in the run, and a parenthesised transliteration is not
 * either. What comes back is what a reader would call "the Arabic in this
 * sentence".
 */
export function extractArabicRuns(text: string): string[] {
  const runs = text.match(ARABIC_RUN) ?? [];
  return runs
    .map((run) => run.replace(RUN_EDGE, "").trim())
    .filter((run) => containsArabic(run));
}

/**
 * The form two pieces of Arabic are compared in.
 *
 * `normalizeArabic` already folds the spelling variants — diacritics, tatweel,
 * alef, ya, ta marbuta — and is reused rather than reimplemented: two
 * normalisers that disagree is how "are these the same string" stops being one
 * question. Layered on top are the wasla and everything that is not Arabic
 * script, because this comparison runs over prose, where the same phrase
 * appears bare, inside markdown emphasis, and trailed by a comma.
 *
 * Folding is what makes "is the tutor quoting the page?" answerable. A tutor
 * quoting a transcript line re-types it with the vowels the lesson wants, and a
 * character-exact comparison would miss the quote and send a native speaker's
 * own words off to be corrected.
 */
export function foldArabic(text: string): string {
  return normalizeArabic(text)
    .replace(/\u0671/g, "\u0627") // wasla: ٱ -> ا
    .replace(new RegExp(`[^${ARABIC_CHAR}\\s]`, "g"), "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ReviewTarget {
  /** 1-based, and what the judge is asked to cite. */
  id: number;
  /** The run as the learner saw it, diacritics and all. */
  arabic: string;
}

export interface SelectOptions {
  /**
   * Arabic the tutor did not write: the page context, the seed sentence, the
   * learner's own messages. A run found here is a quotation and is never
   * reviewed — the transcript of a native speaker is the ground truth this
   * whole app is built on, and "correcting" it would be the app telling a
   * learner that the clip they are watching is wrong.
   */
  sources?: string[];
  /** Most runs to ask about. Four is a chat reply's worth; the judge is paid per call, not per line. */
  maxTargets?: number;
  /** Shortest run worth an opinion, in characters after folding. */
  minChars?: number;
}

/**
 * Which runs in `text` are worth a native speaker's opinion.
 *
 * Single words are deliberately eligible: "how do I say X" is the commonest
 * question the assistant answers, and the whole reply is often one word. It is
 * also exactly where the MSA-leak word list is weakest — a list can only catch
 * the MSA it already knows.
 */
export function selectReviewTargets(text: string, opts: SelectOptions = {}): ReviewTarget[] {
  const maxTargets = opts.maxTargets ?? 4;
  const minChars = opts.minChars ?? 3;
  const quoted = new Set(
    (opts.sources ?? [])
      .flatMap((source) => extractArabicRuns(source ?? ""))
      .map(foldArabic)
      .filter(Boolean),
  );

  const seen = new Set<string>();
  const targets: ReviewTarget[] = [];

  for (const run of extractArabicRuns(text)) {
    const key = foldArabic(run);
    if (key.length < minChars) continue;
    if (seen.has(key)) continue;
    // Substring either way: the tutor quotes a line out of a longer one as
    // readily as it quotes the whole thing.
    if ([...quoted].some((source) => source.includes(key) || key.includes(source))) continue;
    seen.add(key);
    targets.push({ id: targets.length + 1, arabic: run });
    if (targets.length >= maxTargets) break;
  }

  return targets;
}

/**
 * What the judge is told.
 *
 * Three things this prompt has to get right, each learned elsewhere in this
 * codebase: the field names are demanded in English (a smaller Arabic model
 * asked in Arabic translates the keys as readily as the values — see
 * `parseDialectIssues`), the note is capped in *words* rather than tokens, and
 * the default answer is an empty array. A judge that believes it is expected to
 * find something will find something.
 */
export function buildReviewSystemPrompt(dialectLabel: string): string {
  return `You are a native speaker of ${dialectLabel} Arabic reviewing lines written by a language tutor for a learner of ${dialectLabel}.

For each numbered line, decide ONE thing: would a ${dialectLabel} speaker actually say it that way in everyday speech?

Flag a line ONLY when it is wrong for ${dialectLabel}:
- "msa" — it is Modern Standard Arabic (فصحى) rather than everyday ${dialectLabel}.
- "dialect" — it is a different spoken dialect, or a word ${dialectLabel} speakers do not use.

Do NOT flag a line for spelling, for missing vowels, for being informal, or because you would personally phrase it differently. Natural ${dialectLabel} that you would not have chosen is still correct.

Reply with a JSON array and nothing else. Keep every field name in English:
[{"id": 1, "verdict": "ok" | "msa" | "dialect", "suggestion": "<the line as a ${dialectLabel} speaker would say it, Arabic script only>", "note": "<under twelve words, in English, why>"}]

Include an entry for every line. Use "ok" when the line is fine, with an empty suggestion and note. If every line is fine, reply [].`;
}

/** The numbered lines the judge is asked about. */
export function renderReviewTargets(targets: ReviewTarget[]): string {
  return targets.map((target) => `${target.id}. ${target.arabic}`).join("\n");
}

export type CorrectionKind = "msa" | "dialect";

export interface ReviewCorrection {
  /** The run as it appeared in the reply, so the client can point at it. */
  arabic: string;
  /** What the judge would have said instead. */
  suggestion: string;
  /** Under a dozen words of English. May be empty. */
  note: string;
  kind: CorrectionKind;
}

const MAX_SUGGESTION_CHARS = 200;
const MAX_NOTE_CHARS = 140;

/**
 * Pull a JSON array out of a model reply.
 *
 * Tolerant in the three ways the Arabic roster has actually failed this
 * codebase before: a fenced block, prose wrapped around the JSON, and
 * Python-style single quotes. Not tolerant of a missing array — that is what
 * `accept` is for, and a rung that cannot produce one has a successor.
 */
export function parseJsonArray(raw: string): unknown[] | null {
  if (!raw) return null;
  const unfenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  const slice = unfenced.slice(start, end + 1);
  for (const candidate of [slice, slice.replace(/'/g, '"')]) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

/** Whether a reply is one this caller can read at all — `judgeWithArabicNative`'s `accept`. */
export function isParseableReview(raw: string): boolean {
  return parseJsonArray(raw) !== null;
}

const FIELD_ALIASES: Record<string, string[]> = {
  id: ["id", "index", "line", "رقم", "السطر"],
  verdict: ["verdict", "type", "الحكم", "النوع"],
  suggestion: ["suggestion", "correction", "fix", "الاقتراح", "التصحيح", "البديل"],
  note: ["note", "reason", "why", "السبب", "الملاحظة"],
};

function field(row: Record<string, unknown>, name: keyof typeof FIELD_ALIASES): unknown {
  for (const alias of FIELD_ALIASES[name]) {
    if (alias in row) return row[alias];
  }
  return undefined;
}

function asString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * The judge's reply, turned into corrections the client can render.
 *
 * Everything that is not a usable correction is dropped rather than shown: an
 * unknown verdict, an id nobody asked about, a suggestion that is empty, not
 * Arabic, or the same line back again. A "correction" that changes nothing is
 * the most damaging output this feature could have — it teaches the learner to
 * distrust a note that is usually right.
 */
export function parseNativeReview(raw: string, targets: ReviewTarget[]): ReviewCorrection[] {
  const rows = parseJsonArray(raw);
  if (!rows) return [];

  const byId = new Map(targets.map((target) => [target.id, target.arabic]));
  const corrections: ReviewCorrection[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;

    const rawId = field(record, "id");
    const id = typeof rawId === "number" ? rawId : Number.parseInt(String(rawId ?? ""), 10);
    const arabic = byId.get(id);
    if (!arabic) continue;

    const verdict = asString(field(record, "verdict"), 32).toLowerCase();
    if (verdict !== "msa" && verdict !== "dialect") continue;

    const suggestion = asString(field(record, "suggestion"), MAX_SUGGESTION_CHARS);
    if (!containsArabic(suggestion)) continue;
    if (foldArabic(suggestion) === foldArabic(arabic)) continue;

    const key = foldArabic(arabic);
    if (seen.has(key)) continue;
    seen.add(key);

    corrections.push({
      arabic,
      suggestion,
      note: asString(field(record, "note"), MAX_NOTE_CHARS),
      kind: verdict,
    });
  }

  return corrections;
}

// ---- The wire frame ---------------------------------------------------------
//
// The corrections ride the chat's own SSE response rather than a second request:
// the answer they belong to is already streaming, and a follow-up POST would
// need the reply, the page context and the dialect sent up again.
//
// They are namespaced under one key so an app frame can never be mistaken for a
// provider frame — `sseChat` reads `choices[0].delta.content` and would
// otherwise have to guess.

export const APP_FRAME_KEY = "hikaya";

export interface NativeReviewFrame {
  type: "native_review";
  /** Which Arabic-native model judged, for the note's provenance line. */
  model: string;
  corrections: ReviewCorrection[];
}

/** One SSE frame carrying an app payload, terminator included. */
export function encodeAppFrame(frame: NativeReviewFrame): string {
  return `data: ${JSON.stringify({ [APP_FRAME_KEY]: frame })}\n\n`;
}

/**
 * Read an app frame back, or null if this is an ordinary provider frame.
 *
 * Validated field by field rather than cast: this runs in the browser, and the
 * only thing standing between a malformed payload and a render is this
 * function.
 */
export function readAppFrame(parsed: unknown): NativeReviewFrame | null {
  if (!parsed || typeof parsed !== "object") return null;
  const payload = (parsed as Record<string, unknown>)[APP_FRAME_KEY];
  if (!payload || typeof payload !== "object") return null;

  const frame = payload as Record<string, unknown>;
  if (frame.type !== "native_review") return null;
  if (!Array.isArray(frame.corrections)) return null;

  const corrections = frame.corrections.flatMap((entry): ReviewCorrection[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const kind = row.kind === "msa" || row.kind === "dialect" ? row.kind : null;
    if (!kind) return [];
    const arabic = asString(row.arabic, MAX_SUGGESTION_CHARS);
    const suggestion = asString(row.suggestion, MAX_SUGGESTION_CHARS);
    if (!arabic || !suggestion) return [];
    return [{ arabic, suggestion, note: asString(row.note, MAX_NOTE_CHARS), kind }];
  });

  if (corrections.length === 0) return null;
  return { type: "native_review", model: asString(frame.model, 64), corrections };
}
