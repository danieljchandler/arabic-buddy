import { describe, expect, it } from "vitest";
import {
  buildRecapPlan,
  countWindow,
  emptyWindow,
  groupSlips,
  isRecapStep,
  localDateAt,
  parseLocalDate,
  parseStoredPlan,
  parseTzOffset,
  planArabicSources,
  recapBounds,
  recapHeadline,
  recapNotesBlock,
  recapStepKickoff,
  recapSteps,
  recapSystemPrompt,
  RECAP_STEPS,
  RECAP_VERSION,
  sanitizeOutcome,
  STEP_DONE_MARKER,
  windowHasContent,
  windowLabel,
  type RecapVideo,
  type RecapWindow,
} from "../../supabase/functions/_shared/recapCore";
import { spokenLines, type VideoStudyGuide } from "../../supabase/functions/_shared/videoDebriefCore";

/**
 * The daily recap's pure half (`supabase/functions/_shared/recapCore.ts`).
 *
 * The edge tests in `supabase/functions/_test/daily_recap_test.ts` cover the
 * wiring and the reads (`recapWindow.ts`); these cover the decisions — which
 * day "yesterday" is for a learner in Riyadh or in Denver, what counts as
 * something to go over, which words and lines the session is built from, what
 * a stored plan or a client's outcome report is allowed to say, and what the
 * tutor is told.
 */

const LINES = spokenLines([
  { id: "l1", arabic: "شلونك اليوم؟", translation: "How are you today?", startMs: 0, endMs: 1800, tokens: [{ surface: "شلونك", gloss: "how are you" }] },
  { id: "l2", arabic: "والله تعبان شوي", translation: "Honestly a bit tired", startMs: 1800, endMs: 3600, tokens: [{ surface: "تعبان", gloss: "tired" }] },
  { id: "l3", arabic: "ليش؟ شصاير؟", translation: "Why? What happened?", startMs: 3600, endMs: 5200 },
  { id: "l4", arabic: "ما نمت زين البارحة", translation: "I didn't sleep well last night", startMs: 5200, endMs: 7600, tokens: [{ surface: "البارحة", gloss: "last night" }] },
  { id: "l5", arabic: "روح ارتاح يا ريال", translation: "Go and rest, man", startMs: 7600, endMs: 9400 },
]);

const GUIDE: VideoStudyGuide = {
  version: 1,
  summary_en: "Two friends greet; one is tired because he slept badly, and the other tells him to rest.",
  gist: { question_en: "Why is he tired?", question_ar: "", answer_en: "He slept badly.", line_ids: ["l4"] },
  comprehension: [],
  shadow_picks: [{ line_id: "l5", why: "A friendly everyday instruction." }],
  talking_points: [],
  key_phrases: [],
};

const VIDEO: RecapVideo = {
  id: "v1",
  title: "A tired friend",
  dialect: "Gulf",
  cefrLevel: "A2",
  watchedAt: "2026-10-04T18:00:00.000Z",
  completed: true,
  culturalContext: null,
  lines: LINES,
  keyVocabulary: [
    { arabic: "تعبان", english: "tired" },
    { arabic: "البارحة", english: "last night" },
    { arabic: "ارتاح", english: "rest" },
    { arabic: "زين", english: "well" },
  ],
  guide: GUIDE,
};

const BOUNDS = recapBounds({ localDate: "2026-10-05", tzOffsetMinutes: 0, days: 1, now: new Date("2026-10-05T09:00:00Z") });

function aWindow(over: Partial<RecapWindow> = {}): RecapWindow {
  return { ...emptyWindow(BOUNDS, "Gulf"), ...over };
}

describe("the learner's clock", () => {
  it("reads a real calendar date and nothing else", () => {
    expect(parseLocalDate("2026-10-05")).toBe("2026-10-05");
    expect(parseLocalDate(" 2026-10-05 ")).toBe("2026-10-05");
    expect(parseLocalDate("2026-02-30")).toBeNull();
    expect(parseLocalDate("5 Oct 2026")).toBeNull();
    expect(parseLocalDate(20261005)).toBeNull();
  });

  it("clamps the offset to the real range and treats nonsense as UTC", () => {
    expect(parseTzOffset(180)).toBe(180);
    expect(parseTzOffset("-420")).toBe(-420);
    expect(parseTzOffset(5000)).toBe(840);
    expect(parseTzOffset("soon")).toBe(0);
    expect(parseTzOffset(undefined)).toBe(0);
  });

  it("knows which day it is where the learner is", () => {
    const now = new Date("2026-10-05T02:30:00Z");
    expect(localDateAt(now, 180)).toBe("2026-10-05"); // Riyadh, 05:30
    expect(localDateAt(now, -360)).toBe("2026-10-04"); // Denver, 20:30 the evening before
  });

  it("ends yesterday's window at the learner's own midnight", () => {
    const now = new Date("2026-10-05T09:00:00Z");
    const riyadh = recapBounds({ localDate: "2026-10-05", tzOffsetMinutes: 180, days: 1, now });
    expect(riyadh.until).toBe("2026-10-04T21:00:00.000Z");
    expect(riyadh.since).toBe("2026-10-03T21:00:00.000Z");
    const denver = recapBounds({ localDate: "2026-10-04", tzOffsetMinutes: -360, days: 7, now });
    expect(denver.until).toBe("2026-10-04T06:00:00.000Z");
    expect(denver.since).toBe("2026-09-27T06:00:00.000Z");
    expect(denver.days).toBe(7);
  });

  it("falls back to the clock when the client's date is missing or absurd", () => {
    const now = new Date("2026-10-05T09:00:00Z");
    expect(recapBounds({ days: 1, now }).localDate).toBe("2026-10-05");
    expect(recapBounds({ localDate: "2031-01-01", tzOffsetMinutes: 0, days: 1, now }).localDate).toBe("2026-10-05");
    expect(recapBounds({ localDate: "2020-01-01", tzOffsetMinutes: 0, days: 1, now }).localDate).toBe("2026-10-05");
  });

  it("names the window for prose", () => {
    expect(windowLabel(1)).toBe("yesterday");
    expect(windowLabel(7)).toBe("this week");
  });
});

describe("what counts as something to go over", () => {
  it("is nothing for an empty window, whatever the clock", () => {
    expect(windowHasContent(aWindow())).toBe(false);
  });

  it("is anything the learner did, a finished challenge included", () => {
    expect(windowHasContent(aWindow({ chats: ["About شلونك"] }))).toBe(true);
    expect(windowHasContent(aWindow({ challenge: { score: 7, max: 10 } }))).toBe(true);
  });

  it("counts slips by what was being said, not by how many times it went wrong", () => {
    const counts = countWindow(
      aWindow({
        errors: [
          { target_arabic: "بغيت", produced_arabic: "أريد", error_kind: "msa", source: "conversation" },
          { target_arabic: "بغيت", produced_arabic: "أريد", error_kind: "msa", source: "writing" },
          { target_arabic: "شلونك", produced_arabic: "كيف حالك", error_kind: "msa", source: "conversation" },
        ],
        reviewSlips: [{ id: "r1", word_arabic: "زين", word_english: "good" }],
      }),
    );
    expect(counts.slips).toBe(3);
  });

  it("leads the headline with what the learner would recognise as theirs", () => {
    const counts = { videos: 1, words: 4, lookups: 2, slips: 2, lessons: 1, stories: 0, chats: 0 };
    expect(recapHeadline(counts, 1)).toBe("Yesterday: 1 video, 4 new words, 2 slips");
    expect(recapHeadline({ ...counts, videos: 3, words: 0 }, 7)).toBe("This week: 3 videos, 2 words looked up, 2 slips");
    expect(recapHeadline({ ...counts, videos: 0, words: 0, lookups: 0, slips: 0, lessons: 0 }, 1, { score: 7, max: 10 })).toBe(
      "Yesterday: the daily challenge",
    );
    expect(recapHeadline({ ...counts, videos: 0, words: 0, lookups: 0, slips: 0, lessons: 0 }, 1)).toBe("Yesterday: nothing yet");
  });
});

describe("groupSlips", () => {
  it("folds repeated errors on one target into one slip, keeping the learner's own form", () => {
    const slips = groupSlips([
      { target_arabic: "بغيت", produced_arabic: null, error_kind: "pronunciation", source: "shadow" },
      { target_arabic: "بَغيت", produced_arabic: "أريد", error_kind: "msa", source: "conversation" },
      { target_arabic: "شلونك", produced_arabic: "كيف حالك", error_kind: "msa", source: "conversation" },
    ]);
    expect(slips).toHaveLength(2);
    expect(slips[0]).toMatchObject({ target: "بغيت", produced: "أريد", count: 2 });
    expect(slips[0].kinds).toEqual(["pronunciation", "msa"]);
    expect(slips[0].sources).toEqual(["shadow", "conversation"]);
  });

  it("does not record the right answer as the wrong one", () => {
    // A production that normalises to the target is not a slip to show.
    const [slip] = groupSlips([{ target_arabic: "بغيت", produced_arabic: "بَغِيت", error_kind: "tashkeel", source: "writing" }]);
    expect(slip.produced).toBeNull();
  });

  it("drops rows with no target and stops at the limit, most frequent first", () => {
    const rows = ["a", "b", "b", "c", "c", "c", "d"].map((t) => ({ target_arabic: t, produced_arabic: null }));
    expect(groupSlips([...rows, { target_arabic: " " }], 2).map((s) => s.target)).toEqual(["c", "b"]);
  });
});

describe("buildRecapPlan", () => {
  const saved = [
    {
      id: "s1",
      word_arabic: "البارحة",
      word_english: "last night",
      sentence_text: "ما نمت زين البارحة",
      source: "discover",
      source_video_id: "v1",
    },
    // Saved from a lesson, not a video: still quizzed, with no line.
    { id: "s2", word_arabic: "قهوة", word_english: "coffee", source: "lesson" },
    // No gloss anywhere: nothing to mark an answer against.
    { id: "s3", word_arabic: "يلا", word_english: "", source: "lesson" },
  ];
  const lookups = [{ video_id: "v1", word_arabic: "تعبان", word_english: null, line_id: "l2" }];
  const errors = [{ target_arabic: "بغيت", produced_arabic: "أريد", error_kind: "msa", source: "conversation" }];
  const reviewSlips = [{ id: "r1", word_arabic: "زين", word_english: "good", source: "e2e" }];

  const plan = buildRecapPlan(
    aWindow({ videos: [VIDEO], saved, lookups, errors, reviewSlips, lessons: [{ title: "At the souq", status: "completed" }] }),
    { level: "A2", seed: "u:2026-10-05" },
  );

  it("quizzes the learner's own words: from the video first, then saved elsewhere, then review slips", () => {
    expect(plan.quiz.map((q) => q.arabic)).toEqual(["البارحة", "تعبان", "قهوة", "زين"]);
    expect(plan.quiz[0]).toMatchObject({ source: "saved", vocabularyId: "s1", lineId: "l4", videoId: "v1", videoTitle: "A tired friend" });
    // The look-up had no stored gloss; the transcript's token supplied one.
    expect(plan.quiz[1]).toMatchObject({ source: "looked_up", english: "tired", lineId: "l2" });
    expect(plan.quiz[2]).toMatchObject({ source: "saved", vocabularyId: "s2" });
    expect(plan.quiz[2].videoId).toBeUndefined();
    expect(plan.quiz[3]).toMatchObject({ slipped: true, vocabularyId: "r1" });
    expect(plan.marked).toEqual({ saved: 2, lookedUp: 1 });
  });

  it("never tops the quiz up from a video's key vocabulary", () => {
    expect(plan.quiz.some((q) => q.source === "key_vocab")).toBe(false);
    expect(plan.quiz.some((q) => q.arabic === "ارتاح")).toBe(false);
  });

  it("offers the right meaning among others, drawn from the videos' own words", () => {
    for (const item of plan.quiz) {
      if (item.options.length === 0) continue;
      expect(item.options[item.answerIndex]).toBe(item.english);
    }
    expect(plan.quiz[0].options).toContain("rest");
  });

  it("is the same plan for the same window and seed", () => {
    const again = buildRecapPlan(
      aWindow({ videos: [VIDEO], saved, lookups, errors, reviewSlips, lessons: [{ title: "At the souq", status: "completed" }] }),
      { level: "A2", seed: "u:2026-10-05" },
    );
    expect(again).toEqual(plan);
  });

  it("shadows a line carrying one of the learner's words, tagged with its video", () => {
    // The saved word's line wins over the looked-up word's, as in the debrief.
    expect(plan.shadow).toHaveLength(1);
    expect(plan.shadow[0]).toMatchObject({ videoId: "v1", videoTitle: "A tired friend", lineId: "l4" });
  });

  it("carries only the cited lines of a video, with a neighbour either side", () => {
    const [video] = plan.videos;
    expect(video.summary).toBe(GUIDE.summary_en);
    expect(video.lineCount).toBe(5);
    // l2 (look-up) and l4 (saved word) are cited; l1, l3 and l5 are their neighbours.
    expect(video.excerpts.map((l) => l.n)).toEqual([1, 2, 3, 4, 5]);
    expect(video.excerpts[1]).toEqual({ id: "l2", n: 2, arabic: "والله تعبان شوي", translation: "Honestly a bit tired" });
  });

  it("still finds a line to say in a video nothing was marked in", () => {
    const quiet = buildRecapPlan(aWindow({ videos: [VIDEO] }), { level: "B1", seed: "s" });
    expect(quiet.quiz).toEqual([]);
    // The guide's pick, and the excerpt is that line with its neighbour.
    expect(quiet.shadow.map((s) => s.lineId)).toEqual(["l5"]);
    expect(quiet.videos[0].excerpts.map((l) => l.n)).toEqual([4, 5]);
    expect(quiet.steps).toEqual(["yesterday", "retell", "shadow", "recap"]);
  });

  it("has no summary to retell from when a video has no guide", () => {
    const bare = buildRecapPlan(aWindow({ videos: [{ ...VIDEO, guide: null }] }), { level: "B1", seed: "s" });
    expect(bare.videos[0].summary).toBeNull();
    // With no guide and nothing marked, a short line from the middle of the clip.
    expect(bare.shadow.map((s) => s.lineId)).toEqual(["l2"]);
  });

  it("shows the opening lines of a video with nothing to cite", () => {
    const untimed = VIDEO.lines.map(({ startMs: _s, endMs: _e, ...line }) => line);
    const plain = buildRecapPlan(aWindow({ videos: [{ ...VIDEO, guide: null, lines: untimed }] }), { level: "B1", seed: "s" });
    expect(plain.shadow).toEqual([]);
    expect(plain.videos[0].excerpts.map((l) => l.n)).toEqual([1, 2, 3]);
    expect(plain.steps).toEqual(["yesterday", "retell", "recap"]);
  });

  it("groups the slips and runs every step that has something to do", () => {
    expect(plan.slips).toEqual([{ target: "بغيت", produced: "أريد", kinds: ["msa"], sources: ["conversation"], count: 1 }]);
    expect(plan.steps).toEqual(["yesterday", "retell", "words", "slips", "shadow", "recap"]);
    expect(plan.lessons).toEqual([{ title: "At the souq", status: "completed" }]);
    expect(plan.level).toBe("A2");
    expect(plan.date).toBe("2026-10-05");
    expect(plan.windowDays).toBe(1);
  });

  it("skips the steps with nothing in them", () => {
    const thin = buildRecapPlan(aWindow({ chats: ["About greetings"] }), { level: null, seed: "s" });
    expect(thin.steps).toEqual(["yesterday", "recap"]);
    expect(thin.level).toBe("A2");
    expect(recapSteps({ videos: [], quiz: [], slips: [], shadow: [] })).toEqual(["yesterday", "recap"]);
  });

  it("stops at the quiz size", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, word_arabic: `كلمة${i}`, word_english: `word ${i}`, source: "lesson" }));
    expect(buildRecapPlan(aWindow({ saved: many }), { level: "A2", seed: "s", quizSize: 4 }).quiz).toHaveLength(4);
  });
});

describe("parseStoredPlan", () => {
  const plan = buildRecapPlan(aWindow({ videos: [VIDEO] }), { level: "A2", seed: "s" });

  it("reads back what buildRecapPlan wrote", () => {
    expect(parseStoredPlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });

  it("rejects a plan from another version, or with steps it does not know", () => {
    expect(parseStoredPlan({ ...plan, version: RECAP_VERSION + 1 })).toBeNull();
    expect(parseStoredPlan({ ...plan, steps: ["yesterday", "karaoke"] })).toBeNull();
    expect(parseStoredPlan(null)).toBeNull();
    expect(parseStoredPlan("plan")).toBeNull();
  });
});

describe("sanitizeOutcome", () => {
  it("keeps the card results and the steps, bounded, and nothing else", () => {
    const out = sanitizeOutcome({
      quiz: [
        { arabic: "تعبان", english: "tired", correct: true, extra: "no" },
        { arabic: "البارحة", english: "last night", correct: "yes", chosen: "tomorrow" },
        { english: "no arabic" },
      ],
      shadow: [{ lineNumber: 2, arabic: "والله تعبان شوي", score: 140, heard: "والله تعبان" }, { arabic: "x", score: "high" }],
      stepsDone: ["yesterday", "words", "lunch"],
      userId: "someone-else",
    });
    expect(out).toEqual({
      quiz: [
        { arabic: "تعبان", english: "tired", correct: true },
        { arabic: "البارحة", english: "last night", correct: false, chosen: "tomorrow" },
      ],
      shadow: [
        { lineNumber: 2, arabic: "والله تعبان شوي", score: 100, heard: "والله تعبان" },
        { lineNumber: 0, arabic: "x", score: null },
      ],
      stepsDone: ["yesterday", "words"],
    });
  });

  it("answers an empty report to anything that is not one", () => {
    expect(sanitizeOutcome(undefined)).toEqual({ quiz: [], shadow: [], stepsDone: [] });
    expect(sanitizeOutcome("done")).toEqual({ quiz: [], shadow: [], stepsDone: [] });
  });
});

describe("what the tutor is told", () => {
  const plan = buildRecapPlan(
    aWindow({
      videos: [VIDEO],
      saved: [{ id: "s1", word_arabic: "البارحة", word_english: "last night", sentence_text: "ما نمت زين البارحة", source: "discover", source_video_id: "v1" }],
      errors: [{ target_arabic: "بغيت", produced_arabic: "أريد", error_kind: "msa", source: "conversation" }],
      chats: ["About greetings"],
      openQuestions: ["Wanted to know when to use يا ريال"],
      challenge: { score: 7, max: 10 },
    }),
    { level: "A2", seed: "s" },
  );
  const ctx = (step: (typeof RECAP_STEPS)[number]) => ({ step, plan, dialectLabel: "Gulf Arabic", learnerBlock: "LEARNER: likes football" });

  it("reads the learner's day back from the notes, never the whole transcript", () => {
    const notes = recapNotesBlock(plan);
    expect(notes).toContain("WHAT THE LEARNER DID YESTERDAY (2026-10-04 to 2026-10-05)");
    expect(notes).toContain('1. "A tired friend" (A2)');
    expect(notes).toContain(`Summary: ${GUIDE.summary_en}`);
    expect(notes).toContain("البارحة — last night (saved in \"A tired friend\") — said in: ما نمت زين البارحة");
    expect(notes).toContain("Target: بغيت — they produced: أريد [msa] in conversation");
    expect(notes).toContain('Things they asked the tutor about: "About greetings"');
    expect(notes).toContain("Daily challenge: 7 of 10.");
    expect(notes).toContain("- Wanted to know when to use يا ريال");
    // The uncited opening line is not a neighbour of line 4 and is not sent.
    expect(notes).not.toContain("شلونك اليوم؟");
    expect(notes).toContain("3. ليش؟ شصاير؟");
  });

  it("frames the session, pitches the language by level, and names the step", () => {
    const prompt = recapSystemPrompt(ctx("slips"));
    expect(prompt).toContain("going over a learner's yesterday");
    expect(prompt).toContain('step 4 of 6: "Fix a slip"');
    expect(prompt).toContain("Write mainly in English");
    expect(prompt).toContain("LEARNER: likes football");
    expect(prompt).toContain("show what they produced next to the right form");
    expect(prompt).toContain(STEP_DONE_MARKER);
    expect(prompt).toContain("Never claim they did something that is not in your notes");
  });

  it("tells each step what it is for", () => {
    expect(recapSystemPrompt(ctx("yesterday"))).toContain("like a coach reading their file back to them");
    expect(recapSystemPrompt(ctx("retell"))).toContain("tell you in their own words what happened");
    expect(recapSystemPrompt(ctx("words"))).toContain("choose the meaning: البارحة");
    expect(recapSystemPrompt(ctx("recap"))).toContain("ONE thing from yesterday to use today");
    const week = recapSystemPrompt({ ...ctx("yesterday"), plan: { ...plan, windowDays: 7 } });
    expect(week).toContain("what they did this week");
  });

  it("opens a step with a stand-in for the learner's message", () => {
    expect(recapStepKickoff("retell")).toBe('(The learner is ready for "Tell it back".)');
  });

  it("hands the native reviewer everything that is not the tutor's own Arabic", () => {
    const sources = planArabicSources(plan);
    expect(sources).toContain("ما نمت زين البارحة");
    expect(sources).toContain("البارحة");
    expect(sources).toContain("بغيت");
    expect(sources).toContain("أريد");
  });

  it("knows its own steps", () => {
    expect(RECAP_STEPS.every(isRecapStep)).toBe(true);
    expect(isRecapStep("gist")).toBe(false);
  });
});
