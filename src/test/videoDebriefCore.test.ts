import { describe, expect, it } from "vitest";
import {
  buildWordQuiz,
  debriefSystemPrompt,
  debriefTranscriptBlock,
  describeQuizResults,
  describeShadowResult,
  guideAuthoredArabic,
  guideIsCurrent,
  guideUserPrompt,
  isDebriefStep,
  lineContaining,
  normalizeCefr,
  numberedTranscript,
  parseKeyVocabulary,
  parseStoredGuide,
  pickShadowLines,
  planSteps,
  sanitizeGuide,
  savedWordsForVideo,
  selectFocusWords,
  spokenLines,
  STEP_DONE_MARKER,
  STUDY_GUIDE_VERSION,
  stripStepMarker,
  transcriptHash,
  tutorLanguageRule,
  type DebriefLine,
  type DebriefPromptContext,
  type VideoStudyGuide,
} from "../../supabase/functions/_shared/videoDebriefCore";

/**
 * The post-video debrief's pure half (`supabase/functions/_shared/videoDebriefCore.ts`).
 *
 * The edge tests in `supabase/functions/_test/video_debrief_test.ts` cover the
 * wiring; these cover the decisions — what counts as a line, when a guide is
 * stale, what a model's guide is allowed to claim, which words and lines a
 * learner is asked about, and what the tutor is told.
 */

const LINES: DebriefLine[] = [
  { id: "a", arabic: "شلونك اليوم؟", translation: "How are you today?", startMs: 0, endMs: 1800 },
  { id: "b", arabic: "والله تَعْبان شوي", translation: "Honestly a bit tired", startMs: 1800, endMs: 3600, tokens: [{ surface: "تَعْبان", gloss: "tired" }] },
  { id: "c", arabic: "ليش؟", translation: "Why?", startMs: 3600, endMs: 4000 },
  { id: "d", arabic: "ما نمت زين البارحة", translation: "I didn't sleep well last night", startMs: 4000, endMs: 6400 },
  { id: "e", arabic: "روح ارتاح يا ريال", translation: "Go and rest, man", startMs: 6400, endMs: 8200 },
  { id: "f", arabic: "إن شاء الله", translation: "God willing" },
];

function aGuide(overrides: Partial<VideoStudyGuide> = {}): VideoStudyGuide {
  return {
    version: STUDY_GUIDE_VERSION,
    summary_en: "A tired friend is told to rest.",
    gist: { question_en: "Why is he tired?", question_ar: "ليش تعبان؟", answer_en: "He slept badly.", line_ids: ["d"] },
    comprehension: [{ question_en: "What is he told?", question_ar: "", answer_en: "To rest.", line_ids: ["e"] }],
    shadow_picks: [{ line_id: "e", why: "Everyday instruction." }],
    talking_points: [{ prompt_en: "How do you rest?", prompt_ar: "شلون ترتاح؟" }],
    key_phrases: [{ arabic: "يا ريال", english: "man", note: "Address.", line_id: "e" }],
    ...overrides,
  };
}

describe("spokenLines", () => {
  it("keeps what was said and drops what was only shown", () => {
    const lines = spokenLines([
      { id: "1", arabic: " مرحبا ", translation: "Hello", startMs: 0, endMs: 900 },
      { id: "2", arabic: "تابعونا", source: "on_screen" },
      { id: "3", arabic: "عنوان", segmentType: "text_overlay" },
      { id: "4", arabic: "" },
      { arabic: "no id" },
      null,
    ]);
    expect(lines).toEqual([{ id: "1", arabic: "مرحبا", translation: "Hello", startMs: 0, endMs: 900 }]);
  });

  it("answers anything that is not a transcript with no lines", () => {
    expect(spokenLines(null)).toEqual([]);
    expect(spokenLines({ lines: [] })).toEqual([]);
  });
});

describe("transcriptHash and guideIsCurrent", () => {
  const hash = transcriptHash(LINES);

  it("ignores timings, which a resync moves without changing a word", () => {
    const resynced = LINES.map((l) => ({ ...l, startMs: (l.startMs ?? 0) + 120 }));
    expect(transcriptHash(resynced)).toBe(hash);
  });

  it("notices a reviewer's edit to the Arabic, the English, or the line ids", () => {
    expect(transcriptHash(LINES.map((l, i) => (i === 2 ? { ...l, arabic: "ليش يعني؟" } : l)))).not.toBe(hash);
    expect(transcriptHash(LINES.map((l, i) => (i === 2 ? { ...l, translation: "How come?" } : l)))).not.toBe(hash);
    // A merge keeps the left line's id and drops the right one's.
    expect(transcriptHash(LINES.filter((l) => l.id !== "c"))).not.toBe(hash);
  });

  it("holds a guide current only for this transcript and this guide version", () => {
    expect(guideIsCurrent({ version: STUDY_GUIDE_VERSION, transcript_hash: hash }, LINES)).toBe(true);
    expect(guideIsCurrent({ version: STUDY_GUIDE_VERSION - 1, transcript_hash: hash }, LINES)).toBe(false);
    expect(guideIsCurrent({ version: STUDY_GUIDE_VERSION, transcript_hash: "x" }, LINES)).toBe(false);
    expect(guideIsCurrent(null, LINES)).toBe(false);
  });
});

describe("the guide generator's input", () => {
  it("numbers the lines so the model can cite them", () => {
    expect(numberedTranscript(LINES.slice(0, 2))).toBe(
      "1. شلونك اليوم؟ — How are you today?\n2. والله تَعْبان شوي — Honestly a bit tired",
    );
  });

  it("cuts an over-long transcript at a line, and says so", () => {
    const out = numberedTranscript(LINES, 60);
    expect(out.split("\n")[0]).toBe("1. شلونك اليوم؟ — How are you today?");
    expect(out).toMatch(/the remaining \d+ lines are not shown/);
  });

  it("carries the video's own notes alongside the transcript", () => {
    const prompt = guideUserPrompt(
      {
        title: "Tired",
        dialectLabel: "Gulf Arabic",
        cefrLevel: "A2",
        isMeme: true,
        vocabulary: [{ word: "تعبان", translation: "tired" }],
        grammarPoints: [{ title: "Negation with ما" }],
      },
      LINES,
    );
    expect(prompt).toContain("Title: Tired");
    expect(prompt).toContain("This is a meme");
    expect(prompt).toContain("تعبان (tired)");
    expect(prompt).toContain("Grammar points: Negation with ما");
    expect(prompt).toContain("Transcript (6 lines):\n1. شلونك");
  });
});

describe("sanitizeGuide", () => {
  const raw = {
    summary_en: "  A tired friend.  ",
    gist: { question_en: "Why tired?", question_ar: "ليش؟", answer_en: "Slept badly.", lines: [4, "4", 40] },
    comprehension: [
      { question_en: "Told what?", question_ar: "", answer_en: "To rest.", lines: [5] },
      { question_en: "No answer", question_ar: "", answer_en: "" },
    ],
    shadow_picks: [{ line: 5, why: "Useful" }, { line: 5, why: "Again" }, { line: 77, why: "Nowhere" }],
    talking_points: [{ prompt_en: "Rest?", prompt_ar: "ترتاح؟" }, { prompt_en: "" }],
    key_phrases: [
      { arabic: "يا ريال", english: "man", note: "Address", line: 5 },
      { arabic: "ارتاح", english: "rest", note: "", line: 99 },
      { arabic: "على راسي", english: "gladly", note: "Never said" },
    ],
  };

  it("maps cited line numbers back to ids and drops the ones pointing nowhere", () => {
    const guide = sanitizeGuide(raw, LINES)!;
    expect(guide.summary_en).toBe("A tired friend.");
    expect(guide.gist.line_ids).toEqual(["d"]);
    expect(guide.comprehension).toHaveLength(1);
    expect(guide.shadow_picks).toEqual([{ line_id: "e", why: "Useful" }]);
    expect(guide.talking_points).toEqual([{ prompt_en: "Rest?", prompt_ar: "ترتاح؟" }]);
  });

  it("keeps only key phrases the video actually contains", () => {
    const guide = sanitizeGuide(raw, LINES)!;
    // A phrase with a bad line number is still real; it is pinned to where it occurs.
    expect(guide.key_phrases.map((k) => [k.arabic, k.line_id])).toEqual([
      ["يا ريال", "e"],
      ["ارتاح", "e"],
    ]);
  });

  it("falls back to the first comprehension question when the gist is missing", () => {
    const guide = sanitizeGuide({ ...raw, gist: null }, LINES)!;
    expect(guide.gist.question_en).toBe("Told what?");
  });

  it("refuses an answer with no summary or no question at all", () => {
    expect(sanitizeGuide({ ...raw, summary_en: "" }, LINES)).toBeNull();
    expect(sanitizeGuide({ ...raw, gist: null, comprehension: [] }, LINES)).toBeNull();
    expect(sanitizeGuide("not json", LINES)).toBeNull();
  });

  it("clamps the counts a model may return", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ question_en: `Q${i}`, question_ar: "", answer_en: "A", lines: [] }));
    expect(sanitizeGuide({ ...raw, comprehension: many }, LINES)!.comprehension).toHaveLength(5);
  });

  it("hands only the Arabic the model wrote to the MSA check", () => {
    const authored = guideAuthoredArabic(raw);
    expect(authored).toContain("ليش؟");
    expect(authored).toContain("ترتاح؟");
    // The quotes from the video are a native speaker's words, not the model's.
    expect(authored).not.toContain("يا ريال");
  });
});

describe("parseStoredGuide", () => {
  it("drops references to lines a reviewer has since removed", () => {
    const stored = aGuide({ shadow_picks: [{ line_id: "e", why: "" }, { line_id: "gone", why: "" }] });
    const lines = LINES.filter((l) => l.id !== "d");
    const guide = parseStoredGuide(stored, lines)!;
    expect(guide.gist.line_ids).toEqual([]);
    expect(guide.shadow_picks.map((p) => p.line_id)).toEqual(["e"]);
  });

  it("rejects a row that is not a guide", () => {
    expect(parseStoredGuide({ summary_en: "x" }, LINES)).toBeNull();
    expect(parseStoredGuide(null, LINES)).toBeNull();
  });
});

describe("the learner's words", () => {
  it("reads the key vocabulary under either historical spelling", () => {
    expect(parseKeyVocabulary([{ arabic: "زين", english: "good" }, { word: "يبي", translation: "wants" }, { arabic: "" }])).toEqual([
      { arabic: "زين", english: "good" },
      { arabic: "يبي", english: "wants" },
    ]);
  });

  it("finds a word's line whatever its tashkeel", () => {
    expect(lineContaining("تعبان", LINES)?.id).toBe("b");
    expect(lineContaining("نمت زين", LINES)?.id).toBe("d");
    // Whole words only: "ريال" is in line e, "يال" is not a word anywhere.
    expect(lineContaining("يال", LINES)).toBeUndefined();
  });

  it("attributes a saved word to this video by its id, or else by its sentence", () => {
    const rows = [
      { id: "1", word_arabic: "ارتاح", word_english: "rest", source_video_id: "v1" },
      { id: "2", word_arabic: "زين", word_english: "well", source_video_id: "v2", sentence_text: "ما نمت زين البارحة" },
      { id: "3", word_arabic: "البارحة", word_english: "last night", source: "discover", sentence_text: "ما نمت زين البارحة" },
      { id: "4", word_arabic: "قهوة", word_english: "coffee", source: "discover", sentence_text: "نشرب قهوة" },
      { id: "5", word_arabic: "شلونك", word_english: "how are you", source: "transcription", sentence_text: "شلونك اليوم؟" },
    ];
    expect(savedWordsForVideo(rows, "v1", LINES).map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("puts saved words before look-ups before key vocabulary, once each", () => {
    const focus = selectFocusWords({
      saved: [{ id: "s1", word_arabic: "البارحة", word_english: "last night", sentence_text: "ما نمت زين البارحة" }],
      lookups: [
        { word_arabic: "تعبان", word_english: null, line_id: "b" },
        { word_arabic: "البارحة", word_english: "yesterday" },
      ],
      keyVocabulary: [{ arabic: "ارتاح", english: "rest" }, { arabic: "تعبان", english: "tired" }, { arabic: "ليش" }],
      lines: LINES,
    });
    expect(focus.map((f) => [f.arabic, f.source])).toEqual([
      ["البارحة", "saved"],
      ["تعبان", "looked_up"],
      ["ارتاح", "key_vocab"],
    ]);
    expect(focus[0]).toMatchObject({ vocabularyId: "s1", lineId: "d", sentenceEnglish: "I didn't sleep well last night" });
    // The look-up had no stored meaning; the token's gloss is used.
    expect(focus[1].english).toBe("tired");
  });

  it("stops at the quiz size", () => {
    const keyVocabulary = Array.from({ length: 10 }, (_, i) => ({ arabic: `كلمة${i}`, english: `word ${i}` }));
    expect(selectFocusWords({ saved: [], lookups: [], keyVocabulary, lines: LINES, max: 3 })).toHaveLength(3);
  });
});

describe("buildWordQuiz", () => {
  const focus = selectFocusWords({
    saved: [],
    lookups: [],
    keyVocabulary: [
      { arabic: "تعبان", english: "tired" },
      { arabic: "البارحة", english: "last night" },
      { arabic: "ارتاح", english: "rest" },
      { arabic: "زين", english: "well" },
      { arabic: "ريال", english: "man" },
    ],
    lines: LINES,
    max: 3,
  });

  it("offers the right meaning among others from the same video", () => {
    const quiz = buildWordQuiz(focus, [{ arabic: "زين", english: "well" }, { arabic: "ريال", english: "man" }], "seed");
    for (const item of quiz) {
      expect(item.options[item.answerIndex]).toBe(item.english);
      expect(item.options).toHaveLength(4);
      expect(new Set(item.options).size).toBe(4);
    }
  });

  it("is stable for the same learner and video, so the chat sees the quiz the plan showed", () => {
    expect(buildWordQuiz(focus, [], "u:v")).toEqual(buildWordQuiz(focus, [], "u:v"));
  });

  it("turns into recall when there are not enough other meanings to choose from", () => {
    const [only] = buildWordQuiz(focus.slice(0, 1), [], "seed");
    expect(only.options).toEqual([]);
    expect(only.answerIndex).toBe(-1);
  });
});

describe("pickShadowLines", () => {
  it("prefers a line carrying one of the learner's words, then the guide's picks", () => {
    const focus = selectFocusWords({
      saved: [{ id: "s", word_arabic: "البارحة", word_english: "last night", sentence_text: "ما نمت زين البارحة" }],
      lookups: [],
      keyVocabulary: [],
      lines: LINES,
    });
    const picked = pickShadowLines(LINES, [{ line_id: "e", why: "Useful" }, { line_id: "a", why: "" }], focus, 2);
    expect(picked.map((p) => p.lineId)).toEqual(["d", "e"]);
    expect(picked[1]).toMatchObject({ lineNumber: 5, why: "Useful", startMs: 6400, endMs: 8200 });
  });

  it("only offers lines with a clip to repeat after, of a sayable length", () => {
    // f has no timings; c is one word.
    const picked = pickShadowLines(LINES, [{ line_id: "f", why: "" }, { line_id: "c", why: "" }], [], 2);
    expect(picked.map((p) => p.lineId)).not.toContain("f");
    expect(picked.map((p) => p.lineId)).not.toContain("c");
    expect(picked).toHaveLength(2);
  });

  it("finds nothing in a transcript with no timings", () => {
    const untimed = LINES.map(({ startMs: _s, endMs: _e, ...rest }) => rest);
    expect(pickShadowLines(untimed, [], [], 2)).toEqual([]);
  });
});

describe("steps and markers", () => {
  it("skips the quiz and the shadowing when there is nothing for them", () => {
    expect(planSteps({ quizCount: 3, shadowCount: 1 })).toEqual(["gist", "comprehension", "words", "shadow", "questions", "recap"]);
    expect(planSteps({ quizCount: 0, shadowCount: 0 })).toEqual(["gist", "comprehension", "questions", "recap"]);
  });

  it("knows its own steps", () => {
    expect(isDebriefStep("words")).toBe(true);
    expect(isDebriefStep("anything")).toBe(false);
  });

  it("strips the step marker, including one still arriving", () => {
    expect(stripStepMarker(`Well done!\n${STEP_DONE_MARKER}`)).toEqual({ text: "Well done!", done: true });
    expect(stripStepMarker("Well done!\n[[STEP_D")).toEqual({ text: "Well done!", done: false });
    expect(stripStepMarker("Plain reply")).toEqual({ text: "Plain reply", done: false });
  });
});

describe("the tutor's language", () => {
  it("reads a level, defaulting to A2", () => {
    expect(normalizeCefr("b2")).toBe("B2");
    expect(normalizeCefr("B1+")).toBe("B1");
    expect(normalizeCefr(null)).toBe("A2");
    expect(normalizeCefr("expert")).toBe("A2");
  });

  it("moves from English scaffolding to dialect as the level rises", () => {
    expect(tutorLanguageRule("A1", "Gulf Arabic")).toContain("Write mainly in English");
    expect(tutorLanguageRule("B1", "Gulf Arabic")).toContain("mainly in simple, natural Gulf Arabic");
    expect(tutorLanguageRule("C2", "Gulf Arabic")).toContain("natural Gulf Arabic throughout");
  });
});

describe("reports back into the conversation", () => {
  it("summarises a quiz", () => {
    expect(
      describeQuizResults([
        { arabic: "تعبان", english: "tired", correct: true },
        { arabic: "البارحة", english: "last night", correct: false, chosen: "rest" },
      ]),
    ).toBe('(Quiz finished — 1 of 2 right.)\nKnew: تعبان (tired)\nMissed: البارحة (last night) — picked "rest"');
  });

  it("reports a shadowing take, or a skipped one", () => {
    expect(describeShadowResult({ lineNumber: 5, arabic: "روح ارتاح", score: 71.6, heard: "روح ارتاح" })).toBe(
      "(Shadowed line 5: روح ارتاح — score 72/100. The recogniser heard: روح ارتاح)",
    );
    expect(describeShadowResult({ lineNumber: 5, arabic: "روح ارتاح", score: null })).toBe(
      "(Skipped shadowing line 5: روح ارتاح)",
    );
  });
});

describe("debriefSystemPrompt", () => {
  const base: DebriefPromptContext = {
    step: "comprehension",
    steps: ["gist", "comprehension", "words", "questions", "recap"],
    dialectLabel: "Gulf Arabic",
    level: "A2",
    title: "Tired",
    guide: aGuide(),
    lines: LINES,
    quiz: buildWordQuiz(
      selectFocusWords({
        saved: [{ id: "s", word_arabic: "البارحة", word_english: "last night", sentence_text: "ما نمت زين البارحة" }],
        lookups: [],
        keyVocabulary: [{ arabic: "ارتاح", english: "rest" }],
        lines: LINES,
      }),
      [],
      "seed",
    ),
    shadow: [],
  };

  it("gives the tutor the notes, the answers and the learner's own words", () => {
    const prompt = debriefSystemPrompt(base);
    expect(prompt).toContain('step 2 of 5: "What happened"');
    expect(prompt).toContain("What is he told? (line 5) — expected: To rest.");
    expect(prompt).toContain("البارحة — last night (saved while watching)");
    // A key-vocabulary word is quizzed but is not something the learner marked.
    expect(prompt).not.toContain("ارتاح — rest (key word");
    expect(prompt).toContain(STEP_DONE_MARKER);
  });

  it("says so when the learner marked nothing", () => {
    const prompt = debriefSystemPrompt({ ...base, quiz: [] });
    expect(prompt).toContain("did not save or look up any words");
  });

  it("sends cited lines and their neighbours, and the whole transcript only for open questions", () => {
    const excerpt = debriefTranscriptBlock(base);
    expect(excerpt).toContain("TRANSCRIPT EXCERPTS");
    // d (gist, saved word) and e (question) are cited; c and f are neighbours; a is neither.
    expect(excerpt).toContain("3. ليش؟");
    expect(excerpt).not.toContain("1. شلونك");

    const full = debriefTranscriptBlock({ ...base, step: "questions" });
    expect(full).toContain("1. شلونك");
  });
});
