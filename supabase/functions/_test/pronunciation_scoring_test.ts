import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  calibrate,
  calibrateAssessment,
  MISPRONOUNCED_CEILING,
  wordAccuracy,
  worstPhoneme,
} from "../_shared/pronunciationScoringCore.ts";
import { arabicSimilarity, normalizeArabic } from "../_shared/arabicMatch.ts";

/**
 * The scoring curve, and the reason it exists.
 *
 * Azure's pronunciation assessment is generous with learner speech in three
 * compounding ways — a word's score is the mean of its phonemes, so one sound
 * missed entirely barely registers; PronScore mixes in fluency and
 * completeness, which are near-100 for any short utterance regardless of how it
 * sounded; and the whole raw scale bunches up above 80. Together they produced
 * the complaint this module answers: a word said badly came back as 100.
 *
 * The tests below pin both halves of the fix — that a butchered take now scores
 * like one, and that a real attempt is still not crushed. The second half
 * matters as much as the first: a scorer nobody can satisfy gets ignored, and
 * the point of the number is that the learner believes it.
 */

const phonemes = (...accuracies: number[]) => accuracies.map((accuracy) => ({ accuracy }));

const aWord = (
  accuracy: number,
  phonemeScores: number[] = [],
  errorType = "None",
) => ({ word: "مرحبا", accuracy, errorType, phonemes: phonemes(...phonemeScores) });

const anAssessment = (over: Record<string, unknown> = {}) =>
  calibrateAssessment({
    accuracy: 90,
    fluency: 95,
    completeness: 100,
    words: [aWord(90, [92, 88, 90])],
    recognizedText: "مرحبا",
    referenceText: "مرحبا",
    ...over,
  } as Parameters<typeof calibrateAssessment>[0]);

// ── The curve ───────────────────────────────────────────────────────────────

Deno.test("the curve never reorders two takes", () => {
  let previous = -1;
  for (let raw = 0; raw <= 100; raw++) {
    const value = calibrate(raw);
    // Monotone is the one property that must hold whatever the anchors are: a
    // learner who improves must never watch their number go down.
    assert(value >= previous, `calibrate(${raw}) = ${value} dropped below ${previous}`);
    previous = value;
  }
});

Deno.test("the curve keeps both ends fixed", () => {
  assertEquals(calibrate(0), 0);
  assertEquals(calibrate(100), 100);
  // A genuinely flawless read still earns 100. The curve redistributes the
  // middle; it does not make a perfect take unachievable.
});

Deno.test("the curve spreads out the top and leaves the bottom alone", () => {
  // Azure puts almost every intelligible attempt between 80 and 100, so that is
  // where the resolution is needed. The same eight raw points are worth more
  // than twice as much up there as they are down in the forties.
  const highBand = calibrate(96) - calibrate(88);
  const lowBand = calibrate(48) - calibrate(40);
  assert(highBand > 2 * lowBand, `high band ${highBand} vs low band ${lowBand}`);
  // Low down it stays close to the identity — a beginner making a real attempt
  // keeps roughly the number they earned rather than being told it was 12.
  assert(Math.abs(calibrate(50) - 50) < 10);
});

Deno.test("the curve clamps nonsense rather than propagating it", () => {
  assertEquals(calibrate(-20), 0);
  assertEquals(calibrate(140), 100);
  assertEquals(calibrate(Number.NaN), 0);
});

// ── The worst sound in a word ───────────────────────────────────────────────

Deno.test("a word is marked down for the one sound that was missed", () => {
  // ح produced as ه is the commonest Arabic error an English speaker makes.
  // Averaged across five phonemes it is worth about five points, which is why
  // it used to disappear.
  const butchered = wordAccuracy(aWord(80, [95, 95, 20, 95, 95]));
  const clean = wordAccuracy(aWord(80, [80, 80, 80, 80, 80]));

  assert(butchered < clean - 15, `${butchered} should sit well below ${clean}`);
});

Deno.test("one bad sound marks a word down without erasing it", () => {
  const score = wordAccuracy(aWord(80, [95, 95, 20, 95, 95]));

  // Weighted at a third, not a veto. The learner said most of the word.
  assert(score > 45 && score < 65, `expected a middling score, got ${score}`);
});

Deno.test("a word Azure did not hear scores zero", () => {
  assertEquals(wordAccuracy(aWord(60, [70, 70], "Omission")), 0);
});

Deno.test("a word flagged as mispronounced cannot score well on its average", () => {
  // Azure regularly marks a word Mispronunciation while still scoring it in the
  // eighties. The flag is the more reliable of the two signals.
  assertEquals(wordAccuracy(aWord(88, [90, 86], "Mispronunciation")), MISPRONOUNCED_CEILING);
});

Deno.test("a phoneme list Azure did not score does not fail a good take", () => {
  // Entries with no score parse as 0. A 0 beside a word Azure itself scored 90
  // is that gap — a real one would have dragged the word down with it.
  assertEquals(worstPhoneme(phonemes(90, 0, 95), 90), 90);
  assertEquals(wordAccuracy(aWord(90, [90, 0, 95])), 90);
});

Deno.test("a zero on a word that scored badly is taken at its word", () => {
  // Here the word score agrees that something went wrong, so the 0 is a sound
  // the learner did not make rather than a gap in the data.
  assertEquals(worstPhoneme(phonemes(60, 0, 55), 40), 0);
  assert(wordAccuracy(aWord(40, [60, 0, 55])) < 30);
});

Deno.test("a word with no phoneme breakdown falls back to its own score", () => {
  assertEquals(worstPhoneme([], 88), null);
  assertEquals(wordAccuracy(aWord(88, [])), 88);
});

// ── The whole utterance ─────────────────────────────────────────────────────

Deno.test("a butchered word no longer comes back near full marks", () => {
  const { overall } = anAssessment({ words: [aWord(80, [95, 95, 20, 95, 95])] });

  // The complaint that started this: a word said wrong scored 100. Anything
  // above "Fair" here would still be telling the learner it was fine.
  assert(overall < 60, `expected a low score, got ${overall}`);
});

Deno.test("a genuinely clean take still scores well", () => {
  const { overall } = anAssessment({
    accuracy: 97,
    words: [aWord(97, [97, 96, 98])],
  });

  // The other half of the brief. Tightening that makes a good take look bad is
  // not accuracy, it is just a different kind of wrong.
  assert(overall >= 90, `expected an excellent score, got ${overall}`);
});

Deno.test("a perfect read is still a hundred", () => {
  const { overall } = anAssessment({
    accuracy: 100,
    words: [aWord(100, [100, 100, 100])],
  });

  assertEquals(overall, 100);
});

Deno.test("fluency and completeness can only push the score down", () => {
  const withPerfectExtras = anAssessment({ fluency: 100, completeness: 100 });
  const withPoorExtras = anAssessment({ fluency: 40, completeness: 100 });

  // The inversion of PronScore. Fluency at 100 must not lift a take whose
  // sounds were wrong; fluency at 40 on a multi-word utterance may lower one.
  assert(withPoorExtras.overall <= withPerfectExtras.overall);
  assertEquals(withPerfectExtras.overall, withPerfectExtras.accuracy);
});

Deno.test("a single word is not marked down for rhythm it cannot have", () => {
  const words = [aWord(90, [92, 88, 90])];
  const fluent = calibrateAssessment({
    accuracy: 90, fluency: 95, completeness: 100, words,
    recognizedText: "مرحبا", referenceText: "مرحبا",
  });
  const halting = calibrateAssessment({
    accuracy: 90, fluency: 30, completeness: 100, words,
    recognizedText: "مرحبا", referenceText: "مرحبا",
  });

  // One word said on its own has no speaking rate and no intonation contour.
  // Scoring it against them marks the learner down for the exercise.
  assertEquals(halting.overall, fluent.overall);
});

Deno.test("words the learner skipped cost them", () => {
  const complete = anAssessment({
    completeness: 100,
    words: [aWord(92, [92, 92]), aWord(90, [90, 90]), aWord(88, [88, 90])],
    recognizedText: "الجو حلو اليوم",
    referenceText: "الجو حلو اليوم",
  });
  const skipped = anAssessment({
    completeness: 66,
    words: [aWord(92, [92, 92]), aWord(0, [], "Omission"), aWord(88, [88, 90])],
    recognizedText: "الجو اليوم",
    referenceText: "الجو حلو اليوم",
  });

  assert(skipped.overall < complete.overall - 20);
});

Deno.test("words nobody asked for cost a little, not everything", () => {
  const clean = anAssessment({
    words: [aWord(90, [92, 88, 90])],
  });
  const padded = anAssessment({
    words: [aWord(90, [92, 88, 90]), aWord(90, [90], "Insertion")],
  });

  // An inserted word is not part of the reference, so it is a penalty rather
  // than something to average an accuracy over — a learner who adds يعني has
  // not mispronounced anything.
  assert(padded.overall < clean.overall);
  assert(padded.overall > clean.overall - 10);
});

Deno.test("a take of something else entirely cannot ride its phoneme scores", () => {
  const { overall } = anAssessment({
    words: [aWord(95, [95, 95])],
    recognizedText: "ما اعرف شنو تقول",
    referenceText: "الجو حلو اليوم",
  });

  // Whatever the learner said, they said it clearly — and it was not this.
  assert(overall < 50, `expected a capped score, got ${overall}`);
});

Deno.test("an unparsed recognised text is not held against the learner", () => {
  const { overall } = anAssessment({ recognizedText: "" });

  // A blank recognised text is a parse gap or a silent recording, both handled
  // before this point. Reading it as "said the wrong thing" would fail good
  // takes on no evidence.
  assert(overall > 70, `expected no ceiling to apply, got ${overall}`);
});

Deno.test("an utterance with no per-word detail falls back to Azure's accuracy", () => {
  const { overall, accuracy } = anAssessment({ words: [], accuracy: 82 });

  assertEquals(overall, accuracy);
  assertEquals(accuracy, Math.round(calibrate(82)));
});

Deno.test("a long word said badly is not cancelled out by a short one said well", () => {
  const shared = {
    accuracy: 70, fluency: 95, completeness: 100,
    recognizedText: "ا ب", referenceText: "ا ب",
  };
  const longWordBad = calibrateAssessment({
    ...shared,
    words: [aWord(40, [40, 40, 40, 40, 40, 40]), aWord(95, [95])],
  });
  const longWordGood = calibrateAssessment({
    ...shared,
    words: [aWord(95, [95, 95, 95, 95, 95, 95]), aWord(40, [40])],
  });

  // Weighted by how much of the utterance each word is. An unweighted mean
  // scores these two identically, which no listener would.
  assert(longWordBad.overall < longWordGood.overall - 20);
});

// ── Arabic matching ─────────────────────────────────────────────────────────

Deno.test("normalisation leaves Arabic-Indic digits alone", () => {
  // The literal-character form of the diacritic class ran from fathatan to the
  // superscript alef, straight through U+0660–U+0669, so every numeral was
  // deleted before comparing and "٥ كتب" matched "٧ كتب" perfectly.
  assertEquals(normalizeArabic("عندي ٥ كتب"), "عندي ٥ كتب");
  assert(arabicSimilarity("٥ كتب", "٧ كتب") < 1);
});

Deno.test("normalisation folds what a speaker cannot distinguish", () => {
  for (
    const [reference, recognised, why] of [
      ["الجَوّ حِلْو", "الجو حلو", "tashkeel"],
      ["أنا رايح", "انا رايح", "hamza on alef"],
      ["إلى البيت", "الي البيت", "alef maqsura vs ya"],
      ["مدرسة كبيرة", "مدرسه كبيره", "ta marbuta vs ha"],
      ["مسـاء", "مساء", "tatweel"],
    ] as const
  ) {
    assertEquals(arabicSimilarity(reference, recognised), 1, why);
  }
});

Deno.test("silence is not a perfect match", () => {
  assertEquals(arabicSimilarity("", "الجو حلو"), 0);
  assertEquals(arabicSimilarity("", ""), 1);
});
