/**
 * pronunciationScoringCore — turns Azure's raw assessment into the number a
 * learner is actually shown.
 *
 * Azure's scores are not wrong so much as *generous*, in three specific ways
 * that stack up until a butchered word comes back in the nineties:
 *
 *   1. A word's AccuracyScore is the mean of its phoneme scores, so one sound
 *      said completely wrong in a five-sound word barely moves it. ح produced
 *      as ه — the single most common Arabic error an English speaker makes —
 *      averages out to somewhere around 85.
 *   2. PronScore folds fluency and completeness in beside accuracy, and both of
 *      those sit near 100 for any short utterance no matter how it sounded. Two
 *      signals that say nothing about pronunciation drag the headline upward.
 *   3. The raw scale is compressed at the top: nearly everything intelligible
 *      lands between 80 and 100, so the band learners actually live in has
 *      almost no resolution.
 *
 * Each gets an answer here. A word is scored on its worst sound as well as its
 * average; the headline starts from accuracy and every other signal can only
 * push it *down*; and both are stretched through a monotone curve that spreads
 * the top end out.
 *
 * Deliberately still forgiving, because a learner who gives up is worse off
 * than one who is flattered. The curve is gentle below 65 so a real attempt is
 * never told it scored 12; the worst sound is weighted at a third, not a veto;
 * and dialect differences surface as phoneme wobble rather than as errors.
 * Accurate is the target, not harsh.
 *
 * Pure — no I/O, no Deno APIs — so it is unit-testable on its own.
 */

import { arabicSimilarity } from "./arabicMatch.ts";

// ── Tunables ────────────────────────────────────────────────────────────────

/**
 * How much a word's worst sound counts against its average.
 *
 * At 0.35 a single butchered phoneme in an otherwise clean word costs roughly
 * 25 points — enough that the learner is told about it, not so much that one
 * awkward consonant erases the word.
 */
export const WORST_PHONEME_WEIGHT = 0.35;

/**
 * A word Azure flagged as mispronounced cannot score above this, whatever
 * average its phonemes came back with. The flag is a more reliable signal than
 * the number beside it: Azure regularly marks a word Mispronunciation while
 * still scoring it in the eighties.
 */
export const MISPRONOUNCED_CEILING = 70;

/**
 * Below this word score, a phoneme reported as a flat 0 is taken at face value.
 * At or above it, the 0 is read as "not scored" instead — Azure's word score is
 * the phoneme aggregate, so a genuine zero would have dragged the word down
 * with it, and failing a good take for a gap in the data is the exact failure
 * mode this module exists to avoid.
 */
export const UNSCORED_ZERO_BELOW = 60;

/**
 * Raw score → the score shown. Monotone piecewise-linear: nearly flat low down
 * (a beginner's honest attempt keeps its number) and steep above 78, where
 * Azure bunches everything together and the differences that matter live.
 */
const CURVE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [30, 26],
  [50, 42],
  [65, 54],
  [78, 65],
  [88, 77],
  [94, 87],
  [98, 95],
  [100, 100],
];

/**
 * Signals other than accuracy only ever subtract, and only once they fall below
 * a threshold that means something went wrong. `clean` is the level at or above
 * which a signal costs nothing; `perPoint` is what each point below it costs.
 */
const COMPLETENESS = { clean: 95, perPoint: 0.30 };
const FLUENCY = { clean: 85, perPoint: 0.15 };
const PROSODY = { clean: 80, perPoint: 0.10 };

/** Each word Azure heard that was not asked for, and the most they can cost. */
const INSERTION = { perWord: 3, cap: 12 };

/**
 * Below this much resemblance between what Azure heard and what was asked for,
 * the take is not really an attempt at the reference at all, and no per-phoneme
 * average should be allowed to carry it.
 */
const HEARD_FLOOR = 0.5;

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface ScoringPhoneme {
  accuracy: number;
}

export interface ScoringWord {
  word: string;
  accuracy: number;
  errorType: string;
  phonemes: ScoringPhoneme[];
}

export interface RawAssessment {
  accuracy: number;
  fluency: number;
  completeness: number;
  prosody?: number;
  words: ScoringWord[];
  recognizedText: string;
  referenceText: string;
}

export interface CalibratedAssessment {
  /** The headline score. */
  overall: number;
  /** Pronunciation accuracy alone, calibrated. */
  accuracy: number;
  /** Calibrated per-word accuracy, index-for-index with the input words. */
  words: number[];
}

// ── The curve ───────────────────────────────────────────────────────────────

function clamp(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(100, v));
}

/**
 * Map a raw 0–100 score onto the scale shown to the learner. Monotone, so the
 * ordering of two takes is never reversed by calibration — only the spacing
 * between them changes. Returns an unrounded value; callers round once, at the
 * end, so intermediate arithmetic does not accumulate rounding.
 */
export function calibrate(raw: number): number {
  const x = clamp(raw);
  for (let i = 1; i < CURVE.length; i++) {
    const [x1, y1] = CURVE[i];
    if (x <= x1) {
      const [x0, y0] = CURVE[i - 1];
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return 100;
}

// ── Words ───────────────────────────────────────────────────────────────────

/**
 * The worst sound in a word, or null when the phoneme breakdown cannot be
 * trusted to have one.
 *
 * Azure returns a phoneme list for some locales and a syllable list for others,
 * and either can arrive with entries carrying no score, which the parser reads
 * as 0. A 0 sitting next to a word Azure itself scored well is that gap, not a
 * sound the learner failed to make, so above `UNSCORED_ZERO_BELOW` the zeros
 * are set aside and the next-worst real score is used.
 */
export function worstPhoneme(
  phonemes: ScoringPhoneme[] | undefined,
  wordScore: number,
): number | null {
  let scores = (phonemes ?? []).map((p) => clamp(p?.accuracy));
  if (scores.length === 0) return null;
  if (wordScore >= UNSCORED_ZERO_BELOW) {
    const scored = scores.filter((n) => n > 0);
    if (scored.length === 0) return null;
    scores = scored;
  }
  return Math.min(...scores);
}

/**
 * One word's honest accuracy on the raw scale, before calibration.
 *
 * A blend of Azure's own average and the worst sound in the word. Azure's
 * average is the anchor — it is authoritative and immune to gaps in the phoneme
 * list — and the worst sound is what stops four clean phonemes from hiding a
 * fifth that was simply not said.
 */
export function wordAccuracy(word: ScoringWord): number {
  const errorType = String(word?.errorType ?? "None");
  // Azure did not hear this word at all. Nothing to average.
  if (errorType === "Omission") return 0;

  const raw = clamp(word?.accuracy);
  const worst = worstPhoneme(word?.phonemes, raw);
  const blended = worst === null
    ? raw
    : (1 - WORST_PHONEME_WEIGHT) * raw + WORST_PHONEME_WEIGHT * worst;

  return errorType === "Mispronunciation"
    ? Math.min(blended, MISPRONOUNCED_CEILING)
    : blended;
}

// ── The whole utterance ─────────────────────────────────────────────────────

/**
 * The ceiling a take earns from how much what Azure heard resembles what was
 * asked for. 100 (no ceiling) once it is recognisably the same utterance;
 * sliding down to 20 for a take with nothing in common with the reference.
 *
 * Skipped when either side is blank: an empty recognised text is a parse gap or
 * a silent recording, both of which are handled elsewhere, and neither should
 * be punished here on no evidence.
 */
function heardCeiling(recognizedText: string, referenceText: string): number {
  if (!recognizedText?.trim() || !referenceText?.trim()) return 100;
  const heard = arabicSimilarity(recognizedText, referenceText);
  return heard >= HEARD_FLOOR ? 100 : 20 + heard * 70;
}

function penalty(value: number, { clean, perPoint }: { clean: number; perPoint: number }): number {
  return Math.max(0, clean - clamp(value)) * perPoint;
}

/**
 * Calibrate a whole assessment: per-word scores, an accuracy for the utterance,
 * and the headline the learner sees.
 */
export function calibrateAssessment(raw: RawAssessment): CalibratedAssessment {
  const words = Array.isArray(raw.words) ? raw.words : [];
  const isInsertion = (w: ScoringWord) => String(w?.errorType ?? "None") === "Insertion";

  const wordScores = words.map(wordAccuracy);

  // Weight each word by how much of the utterance it is, so a long word said
  // badly is not cancelled out by a two-letter one said well. Inserted words
  // are not part of the reference, so they are counted as a penalty below
  // rather than averaged into an accuracy for words nobody asked for.
  let sum = 0;
  let weight = 0;
  words.forEach((w, i) => {
    if (isInsertion(w)) return;
    const share = Math.max(1, (w?.phonemes ?? []).length);
    sum += wordScores[i] * share;
    weight += share;
  });
  // No usable per-word detail — fall back to Azure's own utterance accuracy.
  const accuracyRaw = weight > 0 ? sum / weight : clamp(raw.accuracy);

  const accuracy = calibrate(accuracyRaw);

  // The headline. Accuracy is the anchor and everything else subtracts, which
  // is the whole difference from PronScore: a take cannot be lifted into the
  // nineties by fluency and completeness that were never in doubt.
  let overall = accuracy;
  overall -= penalty(raw.completeness, COMPLETENESS);

  // Fluency and prosody describe rhythm across an utterance. A single word said
  // on its own has neither, and scoring one against them marks a learner down
  // for the exercise rather than for the sound.
  const spokenWords = words.filter((w) => !isInsertion(w)).length;
  if (spokenWords > 1) {
    overall -= penalty(raw.fluency, FLUENCY);
    if (typeof raw.prosody === "number") overall -= penalty(raw.prosody, PROSODY);
  }

  const insertions = words.filter(isInsertion).length;
  overall -= Math.min(INSERTION.cap, insertions * INSERTION.perWord);

  const ceiling = heardCeiling(raw.recognizedText, raw.referenceText);

  return {
    overall: Math.round(Math.max(0, Math.min(ceiling, overall))),
    accuracy: Math.round(Math.min(ceiling, accuracy)),
    words: wordScores.map((s) => Math.round(calibrate(s))),
  };
}
