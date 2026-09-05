import { describe, expect, it } from "vitest";
import { detectMsaLeaks } from "../../supabase/functions/_shared/msaLeakDetector";
import {
  TRACK_DIALECTS,
  arabicSamples,
  lessonSourceKey,
  syllabusLessons,
  trackWordCounts,
  validateSyllabus,
  validateTrack,
  type Syllabus,
  type Track,
  type TrackLesson,
} from "@/lib/curriculumTracks";
import { loadAllTracks, loadDialectTracks, loadSyllabus, stagesOnDisk } from "../../scripts/curriculum/loadTracks";

/**
 * Drift guard for the authored curriculum (curriculum/tracks/).
 *
 * The syllabus is the contract and every dialect file is held to it: same
 * lesson slots in the same order, every target concept realised, the stage's
 * word minimum met, no word introduced twice, grammar only in the six shared
 * categories. Then every Arabic string a lesson ships — words, examples,
 * phrases, dialogue — goes through the MSA-leak detector for its dialect, the
 * same one the Brain's repair pass uses. A leak in a lesson is not caught
 * later; it is taught. So it fails the build here.
 *
 * The second half unit-tests the validator itself against a small in-memory
 * syllabus, so a rule that stops firing is noticed even when the real tracks
 * happen to be clean.
 */

const syllabus = loadSyllabus();

describe("curriculum/tracks/syllabus.json", () => {
  it("is structurally valid", () => {
    expect(validateSyllabus(syllabus)).toEqual([]);
  });

  it("covers Stage 1 through Stage 3 with contiguous lessons", () => {
    expect(syllabus.stages.map((s) => s.stage)).toEqual([1, 2, 3]);
    for (const stage of syllabus.stages) {
      expect(stage.lessons.map((l) => l.lesson_number)).toEqual(stage.lessons.map((_, i) => i + 1));
    }
  });
});

describe("authored dialect tracks", () => {
  // Every dialect must ship every stage the syllabus defines. A dialect
  // missing a stage is a gap in the product, not a partial build.
  for (const dialect of TRACK_DIALECTS) {
    it(`${dialect} has every syllabus stage on disk`, () => {
      expect(stagesOnDisk(dialect)).toEqual(syllabus.stages.map((s) => s.stage));
    });

    it(`${dialect} tracks match the syllabus`, () => {
      const seen = new Map<string, string>();
      const issues = loadDialectTracks(dialect).flatMap((track) => validateTrack(track, syllabus, seen));
      expect(issues).toEqual([]);
    });

    it(`${dialect} tracks contain no MSA or cross-dialect leaks`, () => {
      const leaks = loadDialectTracks(dialect).flatMap((track) =>
        arabicSamples(track)
          .map((sample) => ({ ...sample, leaks: detectMsaLeaks(sample.text, dialect).leaks }))
          .filter((s) => s.leaks.length > 0)
          .map((s) => `${s.path}: ${s.leaks.join(", ")} in "${s.text}"`),
      );
      expect(leaks).toEqual([]);
    });
  }

  it("reaches the word counts the stages promise", () => {
    // Stage 1 is 12 × 12, Stages 2–3 are 14 × 14 at minimum; the whole track
    // has to land a learner past 500 new words by the end of the Bridge.
    for (const dialect of TRACK_DIALECTS) {
      const counts = trackWordCounts(loadDialectTracks(dialect));
      expect(counts.total, `${dialect} total words`).toBeGreaterThanOrEqual(500);
    }
  });

  it("realises the same concepts in every dialect", () => {
    // The point of concept keys: a learner switching dialect lands on the
    // same lesson and the same set of ideas, in different words.
    const byDialect = new Map<string, Set<string>>();
    for (const track of loadAllTracks()) {
      const set = byDialect.get(track.dialect) ?? new Set<string>();
      for (const lesson of track.lessons) for (const w of lesson.vocabulary) if (w.concept_key) set.add(`${lesson.slug}:${w.concept_key}`);
      byDialect.set(track.dialect, set);
    }
    const targets = new Set(syllabusLessons(syllabus).flatMap((l) => l.target_concepts.map((c) => `${l.slug}:${c.key}`)));
    for (const [dialect, set] of byDialect) {
      const missing = [...targets].filter((t) => !set.has(t));
      expect(missing, `${dialect} missing concepts`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// The validator itself.

const line = (arabic: string, transliteration = "x", english = "y") => ({ arabic, transliteration, english });

const MINI_SYLLABUS: Syllabus = {
  version: 1,
  stages: [
    {
      stage: 1,
      name: "Foundations",
      cefr: "Pre-A1 → A1",
      words_per_lesson: 2,
      lessons: [
        {
          slug: "objects",
          lesson_number: 1,
          title: "Objects",
          theme: "Objects",
          cefr_target: "Pre-A1",
          can_do: ["Recognise objects"],
          grammar: [],
          culture: "Coffee first.",
          target_concepts: [{ key: "water", gloss: "water" }, { key: "coffee", gloss: "coffee" }],
          video_scene: "Objects named on screen.",
        },
        {
          slug: "greetings",
          lesson_number: 2,
          title: "Greetings",
          theme: "Greetings",
          cefr_target: "Pre-A1",
          can_do: ["Greet"],
          grammar: [{ category: "pronouns", point: "-ak/-ik" }],
          culture: "Replies.",
          target_concepts: [{ key: "hello", gloss: "hello" }],
          video_scene: "Two people greeting.",
        },
      ],
    },
  ],
};

function word(arabic: string, english: string, concept?: string) {
  return {
    arabic,
    transliteration: "x",
    english,
    category: "noun",
    teaching_note: "why",
    image_scene: "what",
    concept_key: concept,
    example: line(`هذا ${arabic}`),
  };
}

function lesson(over: Partial<TrackLesson> = {}): TrackLesson {
  return {
    slug: "objects",
    lesson_number: 1,
    title: "Objects",
    title_arabic: "الأشياء",
    description: "d",
    cefr_target: "Pre-A1",
    duration_minutes: 15,
    approach: "a",
    unlock_condition: "u",
    icon: "🏠",
    can_do: ["Recognise objects"],
    grammar: [],
    culture: [{ title: "Coffee", note: "first", phrases: [line("تفضل قهوة")] }],
    vocabulary: [word("ماي", "water", "water"), word("قهوة", "coffee", "coffee")],
    dialogue: [
      { speaker: "A", ...line("تفضل") },
      { speaker: "B", ...line("شكرا") },
    ],
    sound_spotlight: [{ sound: "ق", example: "قهوة", explanation: "g" }],
    lesson_sequence: [{ step: "Listen", detail: "hear it" }],
    real_world_prompts: [{ prompt: "Look around", context: "after" }],
    video_needs: { queries: ["قهوة عربية"], channels: [], scene: "coffee poured" },
    ...over,
  };
}

function greetings(over: Partial<TrackLesson> = {}): TrackLesson {
  return lesson({
    slug: "greetings",
    lesson_number: 2,
    title: "Greetings",
    title_arabic: "التحيات",
    vocabulary: [word("هلا", "hello", "hello"), word("مرحبا", "hi")],
    grammar: [{ category: "pronouns", title: "-ak", explanation: "who", examples: [line("شلونك")] }],
    ...over,
  });
}

const track = (lessons: TrackLesson[], over: Partial<Track> = {}): Track => ({
  dialect: "Gulf",
  stage: 1,
  variety: "Neutral",
  lessons,
  ...over,
});

describe("validateSyllabus", () => {
  it("accepts the mini syllabus", () => {
    expect(validateSyllabus(MINI_SYLLABUS)).toEqual([]);
  });

  it("reports numbering, slug, grammar and concept problems", () => {
    const broken: Syllabus = JSON.parse(JSON.stringify(MINI_SYLLABUS));
    const s = broken.stages[0];
    s.words_per_lesson = 0;
    s.lessons[1].lesson_number = 5;
    s.lessons[1].slug = "objects";
    s.lessons[1].grammar = [{ category: "tenses" as never, point: "x" }];
    s.lessons[1].target_concepts = [{ key: "Bad Key", gloss: "x" }, { key: "Bad Key", gloss: "x" }];
    s.lessons[1].can_do = [];
    s.lessons[1].title = "";
    s.lessons[1].cefr_target = "";
    s.lessons[1].video_scene = "";
    s.lessons[0].target_concepts = [];
    broken.stages.push({ ...s, lessons: [] });
    const issues = validateSyllabus(broken);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("words_per_lesson"),
        expect.stringContaining("lesson_number 5, expected 2"),
        expect.stringContaining("slug duplicated"),
        expect.stringContaining("unknown grammar category tenses"),
        expect.stringContaining("must be snake_case"),
        expect.stringContaining("duplicated"),
        expect.stringContaining("no target concepts"),
        expect.stringContaining("can_do empty"),
        expect.stringContaining("title missing"),
        expect.stringContaining("cefr_target missing"),
        expect.stringContaining("video_scene missing"),
        expect.stringContaining("stage 1: duplicated"),
      ]),
    );
  });
});

describe("validateTrack", () => {
  it("accepts a complete stage", () => {
    expect(validateTrack(track([lesson(), greetings()]), MINI_SYLLABUS)).toEqual([]);
  });

  it("rejects an unknown dialect or stage outright", () => {
    expect(validateTrack(track([], { dialect: "Levantine" as never }), MINI_SYLLABUS)).toEqual([
      expect.stringContaining("Levantine"),
    ]);
    expect(validateTrack(track([], { stage: 9 }), MINI_SYLLABUS)).toEqual([expect.stringContaining("stage 9")]);
  });

  it("holds the lesson slots to the syllabus, in order", () => {
    expect(validateTrack(track([greetings(), lesson()]), MINI_SYLLABUS)).toContainEqual(
      expect.stringContaining("must be exactly [objects, greetings]"),
    );
    // Partial mode: gaps are fine, wrong order and unknown slugs are not.
    expect(validateTrack(track([greetings()]), MINI_SYLLABUS, new Map(), { allowPartial: true })).toEqual([]);
    expect(validateTrack(track([greetings(), lesson()]), MINI_SYLLABUS, new Map(), { allowPartial: true })).toContainEqual(
      expect.stringContaining("out of syllabus order"),
    );
    expect(validateTrack(track([lesson({ slug: "extra" })]), MINI_SYLLABUS, new Map(), { allowPartial: true })).toContainEqual(
      expect.stringContaining("not in the syllabus: extra"),
    );
  });

  it("insists every target concept has a word and the stage minimum is met", () => {
    const issues = validateTrack(track([lesson({ vocabulary: [word("ماي", "water", "water")] }), greetings()]), MINI_SYLLABUS);
    expect(issues).toContainEqual(expect.stringContaining("1 words, stage minimum is 2"));
    expect(issues).toContainEqual(expect.stringContaining("target concept coffee (coffee) has no word"));
  });

  it("catches a word introduced twice, in one lesson or across lessons", () => {
    const twice = validateTrack(track([lesson({ vocabulary: [word("ماي", "water", "water"), word("ماي", "water again", "coffee")] }), greetings()]), MINI_SYLLABUS);
    expect(twice).toContainEqual(expect.stringContaining("ماي listed twice"));
    const seen = new Map<string, string>();
    validateTrack(track([lesson(), greetings({ vocabulary: [word("هلا", "hello", "hello"), word("ماي", "water")] })]), MINI_SYLLABUS, seen);
    const again = validateTrack(track([lesson(), greetings({ vocabulary: [word("هلا", "hello", "hello"), word("ماي", "water")] })]), MINI_SYLLABUS, new Map());
    expect(again).toContainEqual(expect.stringContaining("ماي already introduced in objects"));
  });

  it("checks the script of every line", () => {
    const issues = validateTrack(
      track([
        lesson({
          title_arabic: "Objects",
          vocabulary: [
            { ...word("water", "water", "water"), transliteration: "ماي", variants: ["water"] },
            { ...word("قهوة", "", "coffee"), example: line("", "", "") },
          ],
        }),
        greetings(),
      ]),
      MINI_SYLLABUS,
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("title_arabic must be Arabic script"),
        expect.stringContaining("vocabulary[0].arabic: must contain Arabic script"),
        expect.stringContaining("vocabulary[0].transliteration: must be Latin"),
        expect.stringContaining('variant "water" must be Arabic script'),
        expect.stringContaining("vocabulary[1].english: must be an English gloss"),
        expect.stringContaining("vocabulary[1].example.arabic"),
      ]),
    );
  });

  it("requires the supporting sections and valid grammar", () => {
    const issues = validateTrack(
      track([
        lesson({
          culture: [],
          dialogue: [{ speaker: "", ...line("تفضل") }],
          lesson_sequence: [],
          real_world_prompts: [{ prompt: "", context: "" }],
          sound_spotlight: [{ sound: "", example: "", explanation: "" }],
          video_needs: { queries: ["coffee"], channels: [], scene: "" },
          duration_minutes: 0,
          can_do: [],
          description: "",
        }),
        greetings({
          grammar: [{ category: "tenses" as never, title: "", explanation: "", examples: [] }],
          culture: [{ title: "", note: "", phrases: [line("x", "y", "z")] }],
          vocabulary: [word("هلا", "hello", "hello"), word("مرحبا", "hi", "hello"), { ...word("يا", "o", "Hello!"), category: "", teaching_note: "", image_scene: "" }],
        }),
      ]),
      MINI_SYLLABUS,
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("culture notes missing"),
        expect.stringContaining("dialogue[0]: speaker missing"),
        expect.stringContaining("dialogue needs at least two lines"),
        expect.stringContaining("lesson_sequence missing"),
        expect.stringContaining("real_world_prompts[0]: prompt and context required"),
        expect.stringContaining("sound_spotlight[0]: sound missing"),
        expect.stringContaining("video_needs.queries[0]: should be an Arabic-script search"),
        expect.stringContaining("video_needs.scene missing"),
        expect.stringContaining("duration_minutes must be positive"),
        expect.stringContaining("can_do empty"),
        expect.stringContaining("description missing"),
        expect.stringContaining("grammar[0]: unknown category tenses"),
        expect.stringContaining("grammar[0]: title missing"),
        expect.stringContaining("grammar[0]: needs examples"),
        expect.stringContaining("culture[0]: title missing"),
        expect.stringContaining("culture[0].phrases[0].arabic"),
        expect.stringContaining("concept_key must be snake_case"),
        expect.stringContaining("concept hello realised twice"),
        expect.stringContaining("category missing"),
        expect.stringContaining("teaching_note missing"),
        expect.stringContaining("image_scene missing"),
      ]),
    );
    // A syllabus slot with grammar targets and a lesson with none.
    expect(validateTrack(track([lesson(), greetings({ grammar: [] })]), MINI_SYLLABUS)).toContainEqual(
      expect.stringContaining("targets grammar but the lesson has no grammar notes"),
    );
    expect(validateTrack(track([lesson({ lesson_number: 3 }), greetings()]), MINI_SYLLABUS)).toContainEqual(
      expect.stringContaining("lesson_number 3 != syllabus 1"),
    );
    expect(validateTrack(track([lesson(), greetings()], { variety: "" }), MINI_SYLLABUS)).toContainEqual(
      expect.stringContaining("variety missing"),
    );
  });
});

describe("helpers", () => {
  it("builds the source key the seed upserts on", () => {
    expect(lessonSourceKey("Egyptian", 2, 7)).toBe("egyptian/s2/l07");
  });

  it("lists every Arabic string a lesson ships", () => {
    const samples = arabicSamples(track([lesson(), greetings()]));
    expect(samples.map((s) => s.text)).toEqual(
      expect.arrayContaining(["الأشياء", "تفضل قهوة", "ماي", "هذا ماي", "تفضل", "شلونك"]),
    );
    expect(samples.every((s) => s.path.startsWith("Gulf/s1/"))).toBe(true);
  });

  it("counts words per stage", () => {
    expect(trackWordCounts([track([lesson(), greetings()]), track([lesson()], { stage: 2 })])).toEqual({
      byStage: { 1: 4, 2: 2 },
      total: 6,
    });
  });
});
