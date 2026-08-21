import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideAudio,
  dropNonArabicLines,
  hasArabicScript,
  noArabicSpeechNote,
  parseAudioVerdict,
  readAsrScript,
} from "../_shared/arabicSpeechGate.ts";

/**
 * `_shared/arabicSpeechGate` — whether there is Arabic in this audio at all.
 *
 * Every ASR engine in the pipeline is pinned to Arabic, so none of them can
 * report "that was an English song": handed one, they answer in Arabic script
 * anyway. That confident nonsense used to become a transcript, a vocabulary
 * list and a difficulty rating for words nobody said — worst of all on memes,
 * where the joke is written on screen and the audio is a trending track.
 *
 * Arabic singing is not a failure. A learner studying an Arabic song wants the
 * lyrics, so only another language and silence are refused.
 */

const ARABIC = "شلونك اليوم الحمد لله بخير وانت شخبارك";
const ALSO_ARABIC = "شلونك اليوم الحمد لله بخير وانت شخبارك اليوم";

Deno.test("readAsrScript accepts ordinary Arabic speech", () => {
  const reading = readAsrScript([ARABIC, ALSO_ARABIC]);

  assertEquals(reading.reading, "arabic");
  assert(reading.arabicLetterRatio > 0.9);
});

Deno.test("readAsrScript refuses engines that wrote another language outright", () => {
  const reading = readAsrScript([
    "we are never ever getting back together",
    "we are never getting back together like ever",
  ]);

  assertEquals(reading.reading, "non_arabic");
  assertEquals(reading.notes.length, 1);
});

Deno.test("readAsrScript treats silence as no speech", () => {
  for (const transcripts of [[], [""], ["  "], [null, undefined], ["اه"]]) {
    assertEquals(readAsrScript(transcripts).reading, "no_speech", JSON.stringify(transcripts));
  }
});

Deno.test("readAsrScript defers when two engines share almost nothing", () => {
  // Two Arabic engines on real speech overlap heavily even when they argue
  // about the dialect. Two engines hallucinating over a music bed do not — but
  // that is a suspicion, not a verdict, so it asks the model rather than
  // dropping the transcript on its own.
  const reading = readAsrScript([
    "بيبي كولا مانجو سيارة قمر مدرسة",
    "خروف طماطم جسر تلفزيون سحاب برتقال",
  ]);

  assertEquals(reading.reading, "unclear");
  assert(reading.agreement !== null && reading.agreement < 0.12);
});

Deno.test("readAsrScript keeps code-switched Arabic", () => {
  // "بس الـ deadline قريب" is a real Gulf sentence. A ratio rule that refused
  // English words inside Arabic speech would throw away the corpus's most
  // characteristic material.
  const reading = readAsrScript([
    "بس الـ deadline قريب واحنا ما خلصنا الـ presentation",
    "بس الـ deadline قريب واحنا ما خلصنا الـ presentation بعد",
  ]);

  assertEquals(reading.reading, "arabic");
});

Deno.test("readAsrScript reports agreement only when there is enough to compare", () => {
  assertEquals(readAsrScript([ARABIC]).agreement, null);
  assert(readAsrScript([ARABIC, ALSO_ARABIC]).agreement !== null);
});

Deno.test("parseAudioVerdict accepts the wordings a model actually returns", () => {
  assertEquals(parseAudioVerdict("arabic_speech"), "arabic_speech");
  assertEquals(parseAudioVerdict("Arabic Song"), "arabic_singing");
  assertEquals(parseAudioVerdict("NON-ARABIC"), "non_arabic");
  assertEquals(parseAudioVerdict("music"), "no_speech");
  assertEquals(parseAudioVerdict("probably fine?"), null);
  assertEquals(parseAudioVerdict(undefined), null);
});

Deno.test("decideAudio keeps Arabic singing", () => {
  const decision = decideAudio(readAsrScript([ARABIC, ALSO_ARABIC]), "arabic_singing");

  assertEquals(decision.verdict, "arabic_singing");
  assertEquals(decision.keepAudioLines, true);
});

Deno.test("decideAudio drops audio the model says is another language", () => {
  const decision = decideAudio(readAsrScript([ARABIC, ALSO_ARABIC]), "non_arabic");

  assertEquals(decision.verdict, "non_arabic");
  assertEquals(decision.keepAudioLines, false);
});

Deno.test("decideAudio keeps the transcript when neither side is sure", () => {
  // A wrongly dropped transcript is the worse failure: a learner can see that a
  // doubtful one is wrong, and cannot see a missing one at all.
  const decision = decideAudio(readAsrScript([
    "بيبي كولا مانجو سيارة قمر مدرسة",
    "خروف طماطم جسر تلفزيون سحاب برتقال",
  ]), null);

  assertEquals(decision.keepAudioLines, true);
});

Deno.test("decideAudio lets the script reading overrule a model that says otherwise", () => {
  // An engine that literally wrote English is not a matter of opinion.
  const decision = decideAudio(
    readAsrScript(["we are never ever getting back together"]),
    "arabic_speech",
  );

  assertEquals(decision.verdict, "non_arabic");
  assertEquals(decision.keepAudioLines, false);
});

Deno.test("hasArabicScript sees dialect letters and ignores digits", () => {
  assertEquals(hasArabicScript("چذي"), true);
  assertEquals(hasArabicScript("گاهي"), true);
  assertEquals(hasArabicScript("hello"), false);
  assertEquals(hasArabicScript("١٢٣"), false);
  assertEquals(hasArabicScript(undefined), false);
});

Deno.test("dropNonArabicLines removes a whole line of Latin but keeps a mixed one", () => {
  const kept = dropNonArabicLines([
    { arabic: "شلونك اليوم" },
    { arabic: "we are never getting back together" },
    { arabic: "بس الـ deadline قريب" },
    { arabic: "" },
  ]);

  assertEquals(kept.map((l) => l.arabic), ["شلونك اليوم", "بس الـ deadline قريب"]);
});

Deno.test("noArabicSpeechNote says what was kept instead", () => {
  const withText = noArabicSpeechNote(
    { verdict: "non_arabic", keepAudioLines: false, reason: "the audio is an English song" },
    true,
  );
  assertEquals(
    withText,
    "This video's audio is not Arabic (the audio is an English song), so the on-screen text was kept and the spoken transcript left empty.",
  );

  const withoutText = noArabicSpeechNote(
    { verdict: "no_speech", keepAudioLines: false, reason: "silence" },
    false,
  );
  assertEquals(
    withoutText,
    "No intelligible speech was found in this video's audio (silence), so there is nothing to transcribe.",
  );
});
