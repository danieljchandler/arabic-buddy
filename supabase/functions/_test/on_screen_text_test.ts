import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildVisualContextText,
  isOnScreenLine,
  normalizeOnScreenSegments,
  segmentsFromLegacyLines,
  segmentsFromVisualBlob,
  stripOnScreenLines,
  summarizeOnScreenText,
  toVisualTimeline,
} from "../_shared/onScreenText.ts";

/**
 * `_shared/onScreenText` — the rules that keep a video's captions out of its
 * transcript.
 *
 * The pipeline used to append every overlay it read to `transcript_lines`,
 * which made a POV caption indistinguishable from something a person said:
 * line-by-line playback tried to play audio that was never there, shadowing
 * offered a recording of silence, and the tutor answered "what did they say"
 * with text nobody spoke. These functions are the split — where an overlay is
 * recognised, where it is taken back out, and what shape it is stored in
 * instead.
 */

Deno.test("normalizeOnScreenSegments keeps a well-formed segment intact", () => {
  const [segment] = normalizeOnScreenSegments([{
    text: "  الزحمة قاتلة  ",
    translation: " The traffic is killing me ",
    transliteration: "iz-zahma qaatila",
    startSeconds: 1.5,
    endSeconds: 4,
    confidence: "high",
  }]);

  assertEquals(segment.text, "الزحمة قاتلة");
  assertEquals(segment.translation, "The traffic is killing me");
  assertEquals(segment.confidence, "high");
  assertEquals(segment.startSeconds, 1.5);
  assertEquals(segment.endSeconds, 4);
});

Deno.test("normalizeOnScreenSegments drops entries with nothing written on them", () => {
  const segments = normalizeOnScreenSegments([
    { text: "   ", startSeconds: 0 },
    { translation: "only a translation", startSeconds: 1 },
    null,
    "not an object",
    { text: "POV: طالب", startSeconds: 2 },
  ]);

  // An overlay with no text is not an overlay, and one that survived would be
  // rendered as an empty row on the learner's screen.
  assertEquals(segments.length, 1);
  assertEquals(segments[0].text, "POV: طالب");
});

Deno.test("normalizeOnScreenSegments repairs the fields a vision model gets wrong", () => {
  const [segment] = normalizeOnScreenSegments(
    [{ text: "شنو هذا", startSeconds: "3", endSeconds: null, confidence: "very sure" }],
    12,
  );

  // Timestamps arrive as strings, ends go missing, and confidence comes back
  // as prose. Every one of those is rendered straight onto a timeline.
  assertEquals(segment.startSeconds, 3);
  assertEquals(segment.endSeconds, 12);
  assertEquals(segment.confidence, "medium");
});

Deno.test("normalizeOnScreenSegments never ends a segment before it starts", () => {
  const [segment] = normalizeOnScreenSegments([
    { text: "خلاص", startSeconds: 8, endSeconds: 2 },
  ]);

  assertEquals(segment.startSeconds, 8);
  assertEquals(segment.endSeconds, 8);
});

Deno.test("normalizeOnScreenSegments puts the overlays in the order they appear", () => {
  const segments = normalizeOnScreenSegments([
    { text: "ثالث", startSeconds: 9 },
    { text: "أول", startSeconds: 0 },
    { text: "ثاني", startSeconds: 4 },
  ]);

  assertEquals(segments.map((s) => s.text), ["أول", "ثاني", "ثالث"]);
});

Deno.test("normalizeOnScreenSegments returns nothing for a non-array", () => {
  for (const raw of [undefined, null, "text", 7, {}]) {
    assertEquals(normalizeOnScreenSegments(raw), []);
  }
});

Deno.test("isOnScreenLine recognises both markers the pipeline ever wrote", () => {
  // Two code paths tagged these, and rows exist carrying either one.
  assertEquals(isOnScreenLine({ arabic: "x", source: "on_screen" }), true);
  assertEquals(isOnScreenLine({ arabic: "x", segmentType: "text_overlay" }), true);
  assertEquals(isOnScreenLine({ arabic: "x" }), false);
  assertEquals(isOnScreenLine({ arabic: "x", source: "asr" }), false);
  assertEquals(isOnScreenLine(null), false);
});

Deno.test("stripOnScreenLines leaves the spoken transcript in order", () => {
  const kept = stripOnScreenLines([
    { id: "a", arabic: "شلونك" },
    { id: "b", arabic: "POV: تروح الدوام", source: "on_screen" },
    { id: "c", arabic: "زين" },
    { id: "d", arabic: "نهاية", segmentType: "text_overlay" },
  ]);

  assertEquals(kept.map((l) => l.id), ["a", "c"]);
});

Deno.test("segmentsFromLegacyLines recovers overlays an older run buried in the transcript", () => {
  const segments = segmentsFromLegacyLines([
    { id: "a", arabic: "شلونك", startMs: 0, endMs: 1000 },
    {
      id: "b",
      arabic: "POV: تروح الدوام",
      translation: "POV: you go to work",
      startMs: 2000,
      endMs: 5000,
      source: "on_screen",
      needs_review: true,
    },
  ]);

  // Stripping without recovering would delete the only copy of that caption:
  // these rows predate `visual_timeline`, so the transcript is where it lives.
  assertEquals(segments.length, 1);
  assertEquals(segments[0].text, "POV: تروح الدوام");
  assertEquals(segments[0].startSeconds, 2);
  assertEquals(segments[0].endSeconds, 5);
  assertEquals(segments[0].confidence, "low");
});

Deno.test("toVisualTimeline hangs the scene description on the first moment only", () => {
  const timeline = toVisualTimeline(
    normalizeOnScreenSegments([
      { text: "أول", startSeconds: 0, endSeconds: 2 },
      { text: "ثاني", startSeconds: 3, endSeconds: 5 },
    ]),
    "Two men in a majlis.",
  );

  // The model describes the video as a whole, not one frame at a time, so
  // repeating the scene on every row would claim more than it read.
  assertEquals(timeline[0].scene, "Two men in a majlis.");
  assertEquals("scene" in timeline[1], false);
});

Deno.test("toVisualTimeline omits an empty translation rather than storing a blank", () => {
  const [moment] = toVisualTimeline(normalizeOnScreenSegments([{ text: "خلاص", startSeconds: 0 }]));

  assertEquals("translation" in moment, false);
  assertEquals(moment.text, "خلاص");
});

Deno.test("segmentsFromVisualBlob reads the staged file, and survives a broken one", () => {
  assertEquals(
    segmentsFromVisualBlob({ onScreenTextSegments: [{ text: "أهلين", startSeconds: 0 }] }).length,
    1,
  );
  assertEquals(segmentsFromVisualBlob({}).length, 0);
  assertEquals(segmentsFromVisualBlob(null).length, 0);
});

Deno.test("summarizeOnScreenText writes one timestamped line per overlay", () => {
  const summary = summarizeOnScreenText(normalizeOnScreenSegments([
    { text: "أول", translation: "first", startSeconds: 0, endSeconds: 2 },
    { text: "ثاني", startSeconds: 3, endSeconds: 5 },
  ]));

  assertEquals(summary, "[0s-2s] أول — first\n[3s-5s] ثاني");
});

Deno.test("buildVisualContextText returns nothing when there was nothing to see", () => {
  // An empty string here would be written to `cultural_context` and read by a
  // reviewer as "analysed, nothing found" rather than "never analysed".
  assertEquals(buildVisualContextText([], "", ""), null);
  assertEquals(buildVisualContextText([], "  ", null), null);
});

Deno.test("buildVisualContextText keeps the text, the scene and the notes apart", () => {
  const text = buildVisualContextText(
    normalizeOnScreenSegments([{ text: "الزحمة", startSeconds: 0, endSeconds: 3 }]),
    "One person in a car.",
    "Complaining about traffic is a running joke.",
  );

  assertEquals(
    text,
    "On-screen text:\n[0s-3s] الزحمة\n\nScene: One person in a car.\n\n"
      + "Cultural context: Complaining about traffic is a running joke.",
  );
});
