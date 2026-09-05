/**
 * transcriptLineSplit — break an over-long transcript line into subtitle-sized
 * lines where the speaker actually paused.
 *
 * Two things produce a transcript that is one enormous line. The analyser's
 * merge step can fail and fall back to splitting the raw ASR text on
 * punctuation — which Arabic ASR output mostly lacks — and an older or
 * hand-imported row can simply carry its whole clip as one entry. Either way
 * every learner-facing feature that works line by line (the caption highlight,
 * phrase pause, shadowing, the review workspace) has nothing to work with.
 *
 * Given per-word timings, the right boundaries are not a guess: a pause in
 * the audio is where a subtitle should break. So this looks at the gaps
 * between consecutive words first, then at the clause openers the dialect
 * actually uses (يعني، بس، لكن، عشان…), then at punctuation, and only when
 * none of those exist does it fall back to an even split. Lines that are
 * already a sensible length are never touched — the merge's own segmentation
 * is deliberate, and a reviewer's is ground truth.
 *
 * Pure — no I/O, no Deno APIs. Times are integer milliseconds, matching the
 * `transcript_lines` convention and the `words` array the alignment pass
 * writes on each line (`transcriptTimingAlign.ts`).
 */

import { normalizeArabic } from "./arabicMatch.ts";

/** One timed word of a line — the shape `transcriptTimingAlign` writes. */
export interface SplittableWord {
  surface: string;
  startMs: number;
  endMs: number;
  matched?: boolean;
}

/**
 * The subset of a transcript line the splitter reads and rewrites.
 *
 * `words` and `tokens` are `unknown` rather than typed because every caller
 * holds them as JSON off a jsonb column; they are validated here at runtime
 * instead of trusted from a type.
 */
export interface SplittableLine {
  id?: string;
  arabic?: string;
  startMs?: number;
  endMs?: number;
  words?: unknown;
  tokens?: unknown;
  [key: string]: unknown;
}

const isTimedWord = (w: unknown): w is SplittableWord =>
  !!w && typeof w === "object" &&
  Number.isFinite((w as SplittableWord).startMs) && Number.isFinite((w as SplittableWord).endMs);

export interface SplitOptions {
  /** A line with more words than this is split. */
  maxWords?: number;
  /** Fewest words a split may leave on either side of a length-driven break. */
  minWords?: number;
  /**
   * A gap between two consecutive words at or above this is a silence the
   * line must not span, whatever the line's length.
   */
  longPauseMs?: number;
  /** The id given to piece `n` (1-based) of `parent`. */
  pieceId?: (parent: SplittableLine, n: number) => string;
}

export interface LineSplit {
  parentId: string;
  pieceIds: string[];
}

export interface SplitResult<L extends object> {
  lines: L[];
  /** One entry per input line that was split, in transcript order. */
  splits: LineSplit[];
}

/**
 * Twelve is the merge prompt's own ceiling ("MAXIMUM 12 words per line"), so a
 * merged line never trips this; a little headroom keeps a reviewer's
 * thirteen-word sentence intact too.
 */
export const DEFAULT_MAX_WORDS = 14;
const DEFAULT_MIN_WORDS = 3;
const DEFAULT_LONG_PAUSE_MS = 1_000;

/**
 * Words a spoken-Arabic clause tends to open with. Breaking before one of
 * these keeps a thought together; the list is deliberately the dialects'
 * discourse particles rather than MSA conjunctions.
 */
const CLAUSE_OPENERS = new Set(
  [
    "يعني", "بس", "لكن", "لأن", "لانه", "لأنه", "عشان", "علشان", "عشانه",
    "طيب", "طب", "خلاص", "اذا", "إذا", "لو", "بعدين", "ثم", "وبعدين",
    "يلا", "يالله", "هذا", "هذي", "هاذي", "ده", "دي", "زين", "ايوه", "أيوه",
    "ايوا", "لا", "والله", "اصلا", "أصلا", "مثلا", "يا",
  ].map((w) => normalizeArabic(w)),
);

/** Punctuation that ends a clause, in either script. */
const CLAUSE_END = /[.،,؛;؟?!]$/;

const wordsOf = (arabic: unknown): string[] =>
  String(arabic ?? "").split(/\s+/).filter(Boolean);

/**
 * Where a run of words should break, as indices at which a new line starts.
 *
 * Exposed for the tests; callers want `splitOverlongLines`.
 */
export function chooseLineBreaks(words: SplittableWord[], opts: SplitOptions = {}): number[] {
  const maxWords = Math.max(2, opts.maxWords ?? DEFAULT_MAX_WORDS);
  const minWords = Math.max(1, Math.min(opts.minWords ?? DEFAULT_MIN_WORDS, Math.floor(maxWords / 2)));
  const longPauseMs = Math.max(1, opts.longPauseMs ?? DEFAULT_LONG_PAUSE_MS);
  const n = words.length;
  // A line within the cap is somebody's deliberate segmentation — the merge
  // model's or a reviewer's — and its translation describes exactly these
  // words. It is left alone even when it spans a pause; only the pieces of a
  // line that is being split anyway break at silences.
  if (n <= maxWords) return [];

  const norms = words.map((w) => normalizeArabic(w.surface));
  const timed = words.every((w) => Number.isFinite(w.startMs) && Number.isFinite(w.endMs));
  // gap[i]: silence between word i-1 and word i, in ms. Zero when untimed.
  const gap = (i: number): number =>
    timed ? Math.max(0, words[i].startMs - words[i - 1].endMs) : 0;

  const breaks: number[] = [];

  const split = (lo: number, hi: number): void => {
    const count = hi - lo;
    if (count < 2) return;

    // A real silence is a boundary in its own right, however short the line —
    // a caption should not sit on screen through a two-second pause.
    let pauseAt = -1;
    let pauseGap = 0;
    for (let i = lo + 1; i < hi; i++) {
      const g = gap(i);
      if (g >= longPauseMs && g > pauseGap) { pauseAt = i; pauseGap = g; }
    }
    if (pauseAt >= 0) {
      breaks.push(pauseAt);
      split(lo, pauseAt);
      split(pauseAt, hi);
      return;
    }

    if (count <= maxWords) return;

    // Length-driven: score every legal boundary and take the best. The score
    // is in milliseconds of pause, with the linguistic cues expressed on the
    // same scale so a clear pause always wins and the cues decide between the
    // near-equal candidates a fast talker leaves behind.
    const mid = lo + count / 2;
    const half = count / 2;
    let bestAt = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    const from = lo + minWords;
    const to = hi - minWords; // exclusive: pieces on both sides keep minWords
    for (let i = from; i <= to; i++) {
      let score = Math.min(gap(i), 3_000);
      if (CLAUSE_END.test(words[i - 1].surface)) score += 400;
      const norm = norms[i];
      if (CLAUSE_OPENERS.has(norm)) score += 250;
      else if (norm.length >= 3 && (norm.startsWith("و") || norm.startsWith("ف"))) score += 120;
      // Prefer balanced pieces, so two cues of equal weight split a long line
      // near its middle rather than shaving three words off one end.
      score += 150 * (1 - Math.abs(i - mid) / half);
      if (score > bestScore) { bestScore = score; bestAt = i; }
    }
    if (bestAt < 0) {
      // Too short to honour minWords on both sides yet still over the cap:
      // only possible with a tiny cap. Halve it.
      bestAt = lo + Math.ceil(count / 2);
    }
    breaks.push(bestAt);
    split(lo, bestAt);
    split(bestAt, hi);
  };

  split(0, n);
  return breaks.sort((a, b) => a - b);
}

/**
 * The words of a line as timed entries.
 *
 * Real per-word timings are used when the line carries them and they still
 * describe its text (parallel to the whitespace split of `arabic`). A line
 * without them, or with stale ones from before an edit, gets its span spread
 * evenly across its words — enough to place the pieces, and flagged unmatched
 * so nothing downstream mistakes the spread for measurement.
 */
function timedWords(line: SplittableLine): { words: SplittableWord[]; real: boolean } {
  const surfaces = wordsOf(line.arabic);
  const stored: unknown[] = Array.isArray(line.words) ? line.words : [];
  if (surfaces.length > 0 && stored.length === surfaces.length && stored.every(isTimedWord)) {
    return {
      real: true,
      words: stored.map((w, i) => ({ ...w, surface: surfaces[i] })),
    };
  }
  const startMs = Number(line.startMs);
  const endMs = Number(line.endMs);
  const spanned = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs;
  const step = spanned && surfaces.length > 0 ? (endMs - startMs) / surfaces.length : 0;
  return {
    real: false,
    words: surfaces.map((surface, i) => ({
      surface,
      startMs: spanned ? Math.round(startMs + step * i) : Number.NaN,
      endMs: spanned ? Math.round(startMs + step * (i + 1)) : Number.NaN,
      matched: false,
    })),
  };
}

const defaultPieceId = (parent: SplittableLine, n: number): string =>
  `${String(parent.id ?? "line")}-${n}`;

/**
 * Fields that describe the parent's exact wording and cannot be divided among
 * its pieces. A translation of the whole chunk on one fragment misleads; the
 * caller decides how the pieces get theirs (the re-sync function drafts them,
 * the pipeline leaves them for review).
 */
const NOT_INHERITED = new Set([
  "id", "arabic", "startMs", "endMs", "words", "tokens",
  "translation", "literal", "fusha", "altTranslation", "resolved_by",
  "needs_review", "review_reason",
]);

/**
 * Split every over-long line in `lines` and return the new transcript.
 *
 * Lines within the cap and free of long pauses come back as the same objects.
 * Each piece keeps the parent's other fields (segment type, anything custom),
 * takes its text and span from its own words, keeps the parent's `words` and
 * `tokens` entries for those words when they line up, and carries an empty
 * `translation` flagged `needs_review` / `review_reason: "empty"` — because
 * that is exactly what it is until something translates it.
 */
export function splitOverlongLines<L extends object>(
  lines: L[],
  opts: SplitOptions = {},
): SplitResult<L> {
  if (!Array.isArray(lines)) return { lines: [], splits: [] };
  const pieceId = opts.pieceId ?? defaultPieceId;
  const out: L[] = [];
  const splits: LineSplit[] = [];

  for (const raw of lines) {
    if (!raw || typeof raw !== "object") { out.push(raw); continue; }
    // Every caller's line type is its own (the pipeline's, the analyser's, the
    // editor's), all of them JSON off the same column; the fields read here
    // are checked at runtime rather than demanded of the type.
    const line = raw as SplittableLine;
    const { words, real } = timedWords(line);
    const breaks = words.length >= 2 ? chooseLineBreaks(words, opts) : [];
    if (breaks.length === 0) { out.push(raw); continue; }

    const bounds = [0, ...breaks, words.length];
    const tokens: unknown[] | null =
      Array.isArray(line.tokens) && line.tokens.length === words.length ? line.tokens : null;
    const inherited: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(line)) {
      if (!NOT_INHERITED.has(key)) inherited[key] = value;
    }

    const pieceIds: string[] = [];
    for (let p = 0; p + 1 < bounds.length; p++) {
      const from = bounds[p];
      const to = bounds[p + 1];
      const run = words.slice(from, to);
      const id = pieceId(line, p + 1);
      pieceIds.push(id);
      const timedRun = run.filter((w) => Number.isFinite(w.startMs) && Number.isFinite(w.endMs));
      const startMs = timedRun.length > 0 ? timedRun[0].startMs : undefined;
      const endMs = timedRun.length > 0 ? Math.max(startMs!, ...timedRun.map((w) => w.endMs)) : undefined;
      const piece: SplittableLine = {
        ...inherited,
        id,
        arabic: run.map((w) => w.surface).join(" "),
        translation: "",
        needs_review: true,
        review_reason: "empty",
        ...(startMs !== undefined ? { startMs, endMs } : {}),
        // Only measured timings are worth persisting per word; an even spread
        // would be mistaken for one by the editor and the next re-sync.
        ...(real ? { words: run } : {}),
        tokens: tokens
          ? tokens.slice(from, to)
          : run.map((w, i) => ({ id: `${id}-tok-${i}`, surface: w.surface })),
      };
      out.push(piece as L);
    }
    splits.push({ parentId: String(line.id ?? ""), pieceIds });
  }

  return { lines: out, splits };
}
