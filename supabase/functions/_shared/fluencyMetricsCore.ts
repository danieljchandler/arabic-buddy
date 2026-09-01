/**
 * fluencyMetricsCore — utterance-fluency measures from ASR word timings.
 *
 * Computes the measures the fluency-testing literature says carry proficiency
 * signal (docs/plateau-research-2026-09.md §5): speed measures (speech rate,
 * articulation rate, mean length of run) discriminate adjacent levels; the
 * pause *inventory* separates lower from higher levels; repair counts are
 * non-linear across levels, so they are reported descriptively and must never
 * be scored. Pause *duration* is largely personal speaking style, which is why
 * everything here returns raw numbers and no bands — thresholds have to come
 * from our own accumulated data, not from English-calibrated literature.
 *
 * True clause-boundary pause coding (mid-clause vs end-clause, the strongest
 * L2 signature) needs Arabic clause segmentation that does not exist yet. The
 * per-gap list in the output is the whole record needed to re-derive better
 * location measures later, so it is persisted rather than summarised away.
 *
 * Pure — no I/O, no Deno APIs. Timings are in seconds, matching `AsrWord`.
 */

import { normalizeArabic } from "./arabicMatch.ts";

/** One recognised word with its timing, in seconds from recording start. */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

/**
 * A silent gap between two consecutive words is a pause from this length up.
 * 250ms is the conventional cut in the L2 fluency literature (De Jong 2018);
 * below it, inter-word gaps are articulation, not hesitation.
 */
export const PAUSE_MIN_SEC = 0.25;

/** From this length up a pause reads as a breakdown rather than a breath. */
export const LONG_PAUSE_SEC = 1.0;

/** One inter-word gap that met the pause threshold. */
export interface PauseGap {
  /** Index into the word list of the word this pause follows. */
  afterWord: number;
  durationSec: number;
}

export interface FluencyMetrics {
  /** Whole recording, including lead-in and trailing silence. */
  totalDurationSec: number;
  /** Time inside speech runs — the denominator for articulation rate. */
  phonationTimeSec: number;
  wordCount: number;
  /** Estimated — see estimateSyllables. */
  syllableCount: number;
  /** Syllables over total time. Null when the sample is too empty to rate. */
  speechRateSylPerSec: number | null;
  /** Syllables over phonation time only. */
  articulationRateSylPerSec: number | null;
  /** Maximal pause-free word sequences. */
  runCount: number;
  meanLengthOfRunWords: number | null;
  meanLengthOfRunSyllables: number | null;
  pauseCount: number;
  pauseTimeSec: number;
  meanPauseSec: number | null;
  pausesPerMinute: number | null;
  /** Pauses at or past LONG_PAUSE_SEC. */
  longPauseCount: number;
  /** Silence before the first word — task-response latency. */
  initialSilenceSec: number;
  /** Silence after the last word (stopping early, trailing off). */
  trailingSilenceSec: number;
  /**
   * Immediately repeated words ("ana ana ruht") — the cheapest observable
   * repair. Descriptive only; never fold this into a score.
   */
  repetitionCount: number;
  /** Every qualifying gap, so location measures can be re-derived later. */
  gaps: PauseGap[];
}

const ARABIC_LETTER = /[ء-ي]/;
const LATIN_VOWEL_GROUP = /[aeiouy]+/gi;

/**
 * Rough syllable count for one recognised word.
 *
 * Unvocalised Arabic writes almost no short vowels, so true syllabification is
 * unrecoverable from an ASR transcript. Each Arabic syllable carries exactly
 * one vowel and averages about two letters of unpointed script, so letters/2
 * (rounded up, floor 1) lands within one syllable on typical words — مرحبا →
 * 3 (mar-ha-ba), اليوم → 3 vs the spoken 2. The estimate is applied uniformly
 * to every attempt, so trends and comparisons between a learner's own
 * recordings — the only use these numbers have until internal norms exist —
 * are unaffected by the constant bias.
 *
 * Code-switched English words (this corpus has plenty) count vowel groups.
 */
export function estimateSyllables(word: string): number {
  const normalized = normalizeArabic(word);
  const arabicLetters = [...normalized].filter((ch) => ARABIC_LETTER.test(ch)).length;
  if (arabicLetters > 0) return Math.max(1, Math.ceil(arabicLetters / 2));

  const groups = word.match(LATIN_VOWEL_GROUP)?.length ?? 0;
  if (groups > 0) return groups;
  return word.trim() ? 1 : 0;
}

/** Words grouped into maximal sequences with no qualifying pause inside. */
function splitIntoRuns(words: TimedWord[]): TimedWord[][] {
  const runs: TimedWord[][] = [];
  let current: TimedWord[] = [];
  for (let i = 0; i < words.length; i++) {
    if (current.length > 0) {
      const gap = words[i].start - words[i - 1].end;
      if (gap >= PAUSE_MIN_SEC) {
        runs.push(current);
        current = [];
      }
    }
    current.push(words[i]);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/**
 * The full metric set for one recording.
 *
 * `totalDurationSec` is the recording length the client measured. ASR word
 * timings can only end early (trailing silence is real content for these
 * measures), so the effective duration is whichever is longer — a caller
 * passing 0 for an unknown duration degrades gracefully to the words' span.
 */
export function computeFluencyMetrics(
  words: TimedWord[],
  totalDurationSec: number,
): FluencyMetrics {
  const clean = words
    .filter((w) => w.text.trim().length > 0 && Number.isFinite(w.start) && Number.isFinite(w.end))
    .map((w) => ({ ...w, end: Math.max(w.end, w.start) }))
    .sort((a, b) => a.start - b.start);

  const lastEnd = clean.length > 0 ? clean[clean.length - 1].end : 0;
  const duration = Math.max(
    Number.isFinite(totalDurationSec) ? totalDurationSec : 0,
    lastEnd,
  );

  if (clean.length === 0) {
    return {
      totalDurationSec: duration,
      phonationTimeSec: 0,
      wordCount: 0,
      syllableCount: 0,
      speechRateSylPerSec: null,
      articulationRateSylPerSec: null,
      runCount: 0,
      meanLengthOfRunWords: null,
      meanLengthOfRunSyllables: null,
      pauseCount: 0,
      pauseTimeSec: 0,
      meanPauseSec: null,
      pausesPerMinute: null,
      longPauseCount: 0,
      initialSilenceSec: duration,
      trailingSilenceSec: 0,
      repetitionCount: 0,
      gaps: [],
    };
  }

  const runs = splitIntoRuns(clean);
  // Run span, not summed word durations: the sub-threshold gaps inside a run
  // are articulation and belong in phonation time.
  const phonationTimeSec = runs.reduce(
    (sum, run) => sum + (run[run.length - 1].end - run[0].start),
    0,
  );

  const gaps: PauseGap[] = [];
  for (let i = 1; i < clean.length; i++) {
    const gap = clean[i].start - clean[i - 1].end;
    if (gap >= PAUSE_MIN_SEC) {
      gaps.push({ afterWord: i - 1, durationSec: round3(gap) });
    }
  }

  const syllableCount = clean.reduce((sum, w) => sum + estimateSyllables(w.text), 0);
  const pauseTimeSec = gaps.reduce((sum, g) => sum + g.durationSec, 0);

  let repetitionCount = 0;
  for (let i = 1; i < clean.length; i++) {
    const a = normalizeArabic(clean[i - 1].text);
    const b = normalizeArabic(clean[i].text);
    if (a.length > 0 && a === b) repetitionCount += 1;
  }

  const runWordCounts = runs.map((run) => run.length);
  const runSyllableCounts = runs.map((run) =>
    run.reduce((sum, w) => sum + estimateSyllables(w.text), 0),
  );

  return {
    totalDurationSec: round3(duration),
    phonationTimeSec: round3(phonationTimeSec),
    wordCount: clean.length,
    syllableCount,
    speechRateSylPerSec: duration > 0 ? round3(syllableCount / duration) : null,
    articulationRateSylPerSec: phonationTimeSec > 0 ? round3(syllableCount / phonationTimeSec) : null,
    runCount: runs.length,
    meanLengthOfRunWords: round3(mean(runWordCounts)),
    meanLengthOfRunSyllables: round3(mean(runSyllableCounts)),
    pauseCount: gaps.length,
    pauseTimeSec: round3(pauseTimeSec),
    meanPauseSec: gaps.length > 0 ? round3(pauseTimeSec / gaps.length) : null,
    pausesPerMinute: duration > 0 ? round3((gaps.length / duration) * 60) : null,
    longPauseCount: gaps.filter((g) => g.durationSec >= LONG_PAUSE_SEC).length,
    initialSilenceSec: round3(Math.max(0, clean[0].start)),
    trailingSilenceSec: round3(Math.max(0, duration - lastEnd)),
    repetitionCount,
    gaps,
  };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
