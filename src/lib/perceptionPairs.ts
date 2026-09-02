/**
 * Perception training — the contrasts that gate Arabic listening, the word
 * pairs that isolate them, and the identification items built from those.
 *
 * Pure: no IO, no clock, no randomness the caller didn't seed.
 *
 * Built to the moderators of the HVPT meta-analysis (docs/language-learning-
 * research-2026-09.md §5b), which contradict the obvious design at four
 * points and are the reason this file looks the way it does:
 *
 *   - identification beats discrimination (g = 0.95 vs 0.57): every item asks
 *     "which word/sound was that?", never "same or different?";
 *   - text labels beat pictures (g = 0.90–1.03 vs 0.47): options are Arabic
 *     script, never illustrations;
 *   - gains plateau at ~400 minutes total: the programme has an end
 *     (PROGRAMME_MINUTES), it is not an infinite drill;
 *   - more talkers help only advanced learners: one voice per word is enough
 *     to launch; variety is a later, level-gated addition.
 *
 * Minimal pairs come from the app's own word inventory by single-letter
 * substitution on a contrast letter — the contrasts are orthographic in
 * Arabic, so no phonetic resource is needed to find them.
 */
import { LETTERS_BY_CODE } from "@/data/arabicAlphabet";

export interface Contrast {
  id: string;
  /** The two letters, as they appear in words. `b` is the "plain" partner where there is one. */
  a: string;
  b: string;
  /** arabicAlphabet.ts codes, for sound hints. Hamza has no letter entry. */
  aCode?: string;
  bCode?: string;
  /** One line naming what to listen for. */
  cue: string;
}

/**
 * The contrasts L2 listeners of Arabic most often collapse — pharyngeals,
 * emphatics, and the uvular/velar pair — each against its nearest plain
 * partner. Order is roughly easiest-to-hardest for an English-L1 learner.
 */
export const CONTRASTS: Contrast[] = [
  { id: "sad-sin", a: "ص", b: "س", aCode: "sad", bCode: "sin", cue: "ص is a heavy, hollow 's'; س is light and thin." },
  { id: "ta_heavy-ta", a: "ط", b: "ت", aCode: "ta_heavy", bCode: "ta", cue: "ط is a heavy 't' with the tongue pulled back; ت is a plain 't'." },
  { id: "dad-dal", a: "ض", b: "د", aCode: "dad", bCode: "dal", cue: "ض is a heavy 'd' that darkens the vowel around it; د is a plain 'd'." },
  { id: "qaf-kaf", a: "ق", b: "ك", aCode: "qaf", bCode: "kaf", cue: "ق comes from the back of the throat; ك is a front 'k'." },
  { id: "ha-ha_soft", a: "ح", b: "ه", aCode: "ha", bCode: "ha_soft", cue: "ح is a breathy 'h' squeezed from the throat; ه is a soft 'h' as in 'hat'." },
  { id: "ayn-hamza", a: "ع", b: "ء", aCode: "ayn", cue: "ع is a squeeze deep in the throat; ء is a clean catch, like the break in 'uh-oh'." },
  { id: "ghayn-kha", a: "غ", b: "خ", aCode: "ghayn", bCode: "kha", cue: "غ is voiced, like a French 'r'; خ is a raspy unvoiced 'ch'." },
  { id: "tha-sin", a: "ث", b: "س", aCode: "tha", bCode: "sin", cue: "ث is 'th' as in 'think'; س is 's'. (Many dialects merge them — listen for the speaker's choice.)" },
  { id: "dhal-zay", a: "ذ", b: "ز", aCode: "dhal", bCode: "zay", cue: "ذ is 'th' as in 'this'; ز is 'z'. (Often merged in dialect.)" },
];

export const CONTRASTS_BY_ID: Record<string, Contrast> = Object.fromEntries(
  CONTRASTS.map((c) => [c.id, c]),
);

/** Total training the evidence says pays; gains plateau beyond it. */
export const PROGRAMME_MINUTES = 400;
/** Per contrast, the programme's share. */
export const MINUTES_PER_CONTRAST = Math.round(PROGRAMME_MINUTES / CONTRASTS.length);
/** Days after completing a contrast before it is resurfaced to measure durability. */
export const RESURFACE_AFTER_DAYS = 60;
/** Items per practice round. */
export const ROUND_SIZE = 10;

export interface InventoryWord {
  id: string;
  arabic: string;
  english: string;
  audioUrl: string | null;
}

/** A minimal pair: the same word frame with the contrast letter swapped. */
export interface MinimalPair {
  contrastId: string;
  a: InventoryWord;
  b: InventoryWord;
  /** Character index in the normalised form where the letters differ. */
  position: number;
}

export type ItemKind = "pair" | "letter";

export interface ItemOption {
  /** Arabic script, always — a word or a single letter. */
  label: string;
  correct: boolean;
}

export interface PerceptionItem {
  kind: ItemKind;
  contrastId: string;
  /** What is played. */
  prompt: InventoryWord;
  options: ItemOption[];
  /** Shown after answering, naming the contrast. */
  feedback: string;
}

const DIACRITICS = /[ً-ْٰـ]/g;
const HAMZA_CARRIERS = /[أإؤئآ]/g;

/**
 * Normalise for pair matching. Deliberately NOT arabicWord.normalizeArabicWord:
 * that folds hamza carriers into their bare letters, which erases the very
 * contrast ع/ء needs. Here every carrier becomes ء, so أمل and عمل line up.
 */
export function normalizeForPairs(text: string): string {
  return text
    .replace(DIACRITICS, "")
    .replace(HAMZA_CARRIERS, "ء")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find every minimal pair for a contrast in a word inventory.
 *
 * Substitutes `a`→`b` at each position of every word containing `a` and looks
 * the result up; the reverse direction finds the same pairs, so one direction
 * is enough and each pair comes out once. Multi-word entries are skipped —
 * a pair has to be one word.
 */
export function findMinimalPairs(words: InventoryWord[], contrast: Contrast): MinimalPair[] {
  const byForm = new Map<string, InventoryWord>();
  for (const w of words) {
    const form = normalizeForPairs(w.arabic);
    if (!form || form.includes(" ")) continue;
    if (!byForm.has(form)) byForm.set(form, w);
  }

  const out: MinimalPair[] = [];
  const seen = new Set<string>();
  for (const [form, wordA] of byForm) {
    for (let i = 0; i < form.length; i++) {
      if (form[i] !== contrast.a) continue;
      const swapped = form.slice(0, i) + contrast.b + form.slice(i + 1);
      const wordB = byForm.get(swapped);
      if (!wordB || wordB.id === wordA.id) continue;
      const key = [wordA.id, wordB.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ contrastId: contrast.id, a: wordA, b: wordB, position: i });
    }
  }
  return rankByAudio(out);
}

/** Pairs where both members can actually be played come first. */
export function rankByAudio(pairs: MinimalPair[]): MinimalPair[] {
  const score = (p: MinimalPair) => (p.a.audioUrl ? 1 : 0) + (p.b.audioUrl ? 1 : 0);
  return [...pairs].sort((x, y) => score(y) - score(x));
}

/**
 * Single words that contain exactly one of the contrast's letters — the
 * fallback item when true pairs are scarce: play the word, ask which letter
 * was in it. Still identification, still an orthographic label.
 */
export function findContrastWords(words: InventoryWord[], contrast: Contrast): Array<{ word: InventoryWord; letter: string }> {
  const out: Array<{ word: InventoryWord; letter: string }> = [];
  for (const w of words) {
    const form = normalizeForPairs(w.arabic);
    if (!form || form.includes(" ")) continue;
    const hasA = form.includes(contrast.a);
    const hasB = form.includes(contrast.b);
    if (hasA === hasB) continue;
    out.push({ word: w, letter: hasA ? contrast.a : contrast.b });
  }
  return out.sort((x, y) => (y.word.audioUrl ? 1 : 0) - (x.word.audioUrl ? 1 : 0));
}

/** A tiny seeded PRNG so a round is reproducible in tests. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function letterName(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  const letter = LETTERS_BY_CODE[code];
  return letter ? `${letter.isolated} (${letter.name_translit})` : fallback;
}

function soundHint(code: string | undefined, letter: string): string {
  if (!code) {
    if (letter === "ء") return "a clean catch in the throat, like the break in 'uh-oh'";
    return "";
  }
  return LETTERS_BY_CODE[code]?.sound_hint ?? "";
}

/**
 * Feedback that names the contrast — the explicit form the ASR-feedback
 * evidence favours over a bare tick (research §5, explicit g = 0.86 vs
 * indirect 0.50). Same text whether the answer was right or wrong; the page
 * decides the framing.
 */
export function feedbackFor(contrast: Contrast, heard: string): string {
  const isA = heard === contrast.a;
  const heardCode = isA ? contrast.aCode : contrast.bCode;
  const otherCode = isA ? contrast.bCode : contrast.aCode;
  const other = isA ? contrast.b : contrast.a;
  const hint = soundHint(heardCode, heard);
  return `That was ${letterName(heardCode, heard)}${hint ? ` — ${hint}` : ""}, not ${letterName(otherCode, other)}. ${contrast.cue}`;
}

export interface BuildOptions {
  count?: number;
  seed?: number;
}

/**
 * One round of items for a contrast: minimal-pair items first (play one
 * member, choose between the two), letter items to fill (play a word, choose
 * which contrast letter it contained). Empty when the inventory has nothing
 * for the contrast — the page says so rather than inventing words.
 */
export function buildItems(words: InventoryWord[], contrast: Contrast, options: BuildOptions = {}): PerceptionItem[] {
  const count = options.count ?? ROUND_SIZE;
  const rand = seededRandom(options.seed ?? 1);
  const items: PerceptionItem[] = [];

  const pairs = shuffle(findMinimalPairs(words, contrast), rand);
  for (const pair of pairs) {
    if (items.length >= count) break;
    // Play either member; the learner chooses which word they heard.
    const playA = rand() < 0.5;
    const prompt = playA ? pair.a : pair.b;
    const heard = playA ? contrast.a : contrast.b;
    const opts: ItemOption[] = shuffle(
      [
        { label: pair.a.arabic, correct: playA },
        { label: pair.b.arabic, correct: !playA },
      ],
      rand,
    );
    items.push({ kind: "pair", contrastId: contrast.id, prompt, options: opts, feedback: feedbackFor(contrast, heard) });
  }

  if (items.length < count) {
    const used = new Set(items.map((i) => i.prompt.id));
    const singles = shuffle(findContrastWords(words, contrast), rand).filter((s) => !used.has(s.word.id));
    for (const { word, letter } of singles) {
      if (items.length >= count) break;
      const opts: ItemOption[] = shuffle(
        [
          { label: contrast.a, correct: letter === contrast.a },
          { label: contrast.b, correct: letter === contrast.b },
        ],
        rand,
      );
      items.push({ kind: "letter", contrastId: contrast.id, prompt: word, options: opts, feedback: feedbackFor(contrast, letter) });
    }
  }

  return items;
}

// ── Progress arithmetic (shared by the hook and the page) ───────────────────

export interface ContrastProgressRow {
  contrast_id: string;
  attempts: number;
  correct: number;
  seconds: number;
  completed_at: string | null;
  resurfaced_at: string | null;
  resurface_attempts: number;
  resurface_correct: number;
}

export interface ContrastStatus {
  contrastId: string;
  minutes: number;
  targetMinutes: number;
  accuracy: number | null;
  complete: boolean;
  /** Completed long enough ago that a first-attempt check is due (durability). */
  resurfaceDue: boolean;
}

export function contrastStatus(
  contrastId: string,
  row: ContrastProgressRow | undefined,
  now: Date,
): ContrastStatus {
  const minutes = row ? row.seconds / 60 : 0;
  const accuracy = row && row.attempts > 0 ? row.correct / row.attempts : null;
  const complete = !!row?.completed_at || minutes >= MINUTES_PER_CONTRAST;
  const completedAt = row?.completed_at ? new Date(row.completed_at) : null;
  const resurfaceDue =
    !!completedAt &&
    !row?.resurfaced_at &&
    now.getTime() - completedAt.getTime() >= RESURFACE_AFTER_DAYS * 86_400_000;
  return { contrastId, minutes, targetMinutes: MINUTES_PER_CONTRAST, accuracy, complete, resurfaceDue };
}

export interface ProgrammeStatus {
  minutes: number;
  targetMinutes: number;
  contrastsComplete: number;
  contrastsTotal: number;
  complete: boolean;
}

export function programmeStatus(rows: ContrastProgressRow[], now: Date): ProgrammeStatus {
  const byId = new Map(rows.map((r) => [r.contrast_id, r]));
  const statuses = CONTRASTS.map((c) => contrastStatus(c.id, byId.get(c.id), now));
  const minutes = statuses.reduce((sum, s) => sum + Math.min(s.minutes, s.targetMinutes), 0);
  const contrastsComplete = statuses.filter((s) => s.complete).length;
  return {
    minutes,
    targetMinutes: PROGRAMME_MINUTES,
    contrastsComplete,
    contrastsTotal: CONTRASTS.length,
    complete: contrastsComplete === CONTRASTS.length,
  };
}
