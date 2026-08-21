/**
 * shadowScoring — turning the two shadowing signals into one honest number.
 *
 * A shadowing take is measured two ways: whether the learner said the words the
 * native said in the clip (ASR plus a normalised Arabic edit distance,
 * server-side, in `score-shadow-attempt`), and whether the take *sounds* like
 * the clip (MFCC and dynamic time warping in the browser, `acousticSimilarity`).
 *
 * The words half is the lenient one, and it is lenient in a way that is easy to
 * miss: ASR snaps whatever it hears onto real words. Say مرحبا badly enough to
 * be unrecognisable to a person and the recogniser will still very often write
 * down مرحبا, the edit distance is then zero, and a butchered take scores 100.
 * The transcript is evidence that the learner picked the right words — not that
 * they pronounced them.
 *
 * So two things happen here. Character similarity is stretched through a curve,
 * because on a short phrase 0.9 is one wrong letter and not "nearly perfect".
 * And a take with no acoustic comparison to fall back on — plenty of clips
 * cannot be downloaded, and the exercise still has to work — is capped: with no
 * evidence about how it sounded, the score cannot claim the top of the scale.
 *
 * Pure — no DOM, no network.
 */

/** Weight of the words signal against the sound signal when both are present. */
export const TRANSCRIPT_WEIGHT = 0.55;
export const ACOUSTIC_WEIGHT = 0.45;

/**
 * The most a take can score when the clip's audio could not be fetched and only
 * the transcript was compared. Not a punishment — an honest ceiling on a
 * measurement that cannot see the thing being scored.
 */
export const TRANSCRIPT_ONLY_CEILING = 85;

/**
 * Raw character similarity (as a percentage) → the words score shown.
 *
 * Gentle at the bottom and steep at the top, for the same reason the Azure
 * curve is: the differences that matter are all bunched into the last fifteen
 * points. Note the top anchor — even a transcript that matched perfectly stops
 * at 96, because a perfect transcript is not a perfect take.
 */
const CURVE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [50, 35],
  [70, 55],
  [82, 68],
  [90, 78],
  [95, 87],
  [100, 96],
];

function clamp(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

/**
 * Calibrate the raw 0–100 transcript match into the "Words" score the learner
 * sees. Monotone, so a closer take never scores below a worse one.
 */
export function wordsScore(rawSimilarity: number): number {
  const x = clamp(rawSimilarity);
  for (let i = 1; i < CURVE.length; i++) {
    const [x1, y1] = CURVE[i];
    if (x <= x1) {
      const [x0, y0] = CURVE[i - 1];
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return Math.round(y0 + t * (y1 - y0));
    }
  }
  return 96;
}

/**
 * Combine the calibrated words score with the acoustic match, or fall back to
 * the words score alone — under its ceiling — when there was no clip audio to
 * compare against.
 */
export function shadowOverall(words: number, acoustic: number | null): number {
  if (acoustic == null) return Math.min(TRANSCRIPT_ONLY_CEILING, Math.round(clamp(words)));
  return Math.round(TRANSCRIPT_WEIGHT * clamp(words) + ACOUSTIC_WEIGHT * clamp(acoustic));
}
