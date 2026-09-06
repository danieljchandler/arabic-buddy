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
  type TrackDialect,
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

/**
 * How much of each stage is authored, as a ratchet.
 *
 * The tracks are being written dialect by dialect, so requiring all 38 slots in
 * all three dialects would keep CI red for weeks and tell nobody anything. This
 * pins what exists instead: a lesson may be added freely (raise the number in
 * the same commit — the failure message prints the new one), but a lesson that
 * disappears, or a stage directory that vanishes, fails the build. Every lesson
 * that IS on disk is held to the full contract below, so partial never means
 * unchecked.
 */
const AUTHORED: Record<TrackDialect, Record<number, number>> = {
  Gulf: { 1: 10, 2: 8, 3: 5 },
  Egyptian: { 1: 4, 2: 3, 3: 4 },
  Yemeni: { 1: 9, 2: 5, 3: 6 },
};

describe("authored dialect tracks", () => {
  for (const dialect of TRACK_DIALECTS) {
    it(`${dialect} has at least the lessons it had before`, () => {
      const onDisk = Object.fromEntries(
        loadDialectTracks(dialect).map((track) => [track.stage, track.lessons.length]),
      );
      for (const [stage, expected] of Object.entries(AUTHORED[dialect])) {
        const actual = onDisk[Number(stage)] ?? 0;
        expect(
          actual,
          `${dialect} stage ${stage}: ${actual} lessons on disk, ${expected} pinned in AUTHORED — ` +
            (actual > expected
              ? `raise it to ${actual} in this commit`
              : "a lesson was deleted or renamed"),
        ).toBeGreaterThanOrEqual(expected);
      }
      expect(stagesOnDisk(dialect)).toEqual(
        Object.keys(AUTHORED[dialect]).map(Number).sort((a, b) => a - b),
      );
    });

    it(`${dialect} tracks match the syllabus`, () => {
      const seen = new Map<string, string>();
      const issues = loadDialectTracks(dialect).flatMap((track) =>
        validateTrack(track, syllabus, seen, { allowPartial: true }),
      );
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

  it("teaches every dialect the same concepts in the lessons it has written", () => {
    // The point of concept keys: a learner switching dialect lands on the same
    // lesson and the same set of ideas, in different words. Checked per lesson
    // that exists rather than across the whole syllabus, so an unwritten slot
    // is silence rather than a failure.
    const bySlug = new Map<string, Map<TrackDialect, Set<string>>>();
    for (const track of loadAllTracks()) {
      for (const lesson of track.lessons) {
        const byDialect = bySlug.get(lesson.slug) ?? new Map<TrackDialect, Set<string>>();
        byDialect.set(
          track.dialect,
          new Set(lesson.vocabulary.map((w) => w.concept_key).filter((k): k is string => !!k)),
        );
        bySlug.set(lesson.slug, byDialect);
      }
    }
    const targets = new Map(
      syllabusLessons(syllabus).map((l) => [l.slug, l.target_concepts.map((c) => c.key)]),
    );
    const missing: string[] = [];
    for (const [slug, byDialect] of bySlug) {
      for (const [dialect, keys] of byDialect) {
        for (const key of targets.get(slug) ?? []) {
          if (!keys.has(key)) missing.push(`${dialect} ${slug}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("counts the words the authored lessons carry", () => {
    // Not a threshold — a printout, so a review sees the size of the corpus and
    // a silent collapse (an emptied lesson file) shows up as a number change.
    const counts = Object.fromEntries(
      TRACK_DIALECTS.map((d) => [d, trackWordCounts(loadDialectTracks(d)).total]),
    );
    for (const dialect of TRACK_DIALECTS) {
      expect(counts[dialect], `${dialect} words`).toBeGreaterThan(100);
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

describe("validateTrack on malformed author input", () => {
  it("reports every missing section instead of throwing", () => {
    // Lesson files are hand-written JSON. An author who omits a section (or
    // whose editor eats one) must get a list of what is missing, not a
    // TypeError from the validator — every array is optional-chained for
    // exactly this case, and this is the test that keeps them that way.
    const bare = { slug: "objects", lesson_number: 1 } as unknown as TrackLesson;
    const issues = validateTrack(track([bare]), MINI_SYLLABUS, new Map(), { allowPartial: true });
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("title missing"),
        expect.stringContaining("title_arabic missing"),
        expect.stringContaining("duration_minutes must be positive"),
        expect.stringContaining("can_do empty"),
        expect.stringContaining("culture notes missing"),
        expect.stringContaining("0 words, stage minimum is 2"),
        expect.stringContaining("target concept water (water) has no word"),
        expect.stringContaining("dialogue needs at least two lines"),
        expect.stringContaining("lesson_sequence missing"),
        expect.stringContaining("real_world_prompts missing"),
        expect.stringContaining("video_needs.queries missing"),
        expect.stringContaining("video_needs.scene missing"),
      ]),
    );
  });

  it("reports a row that is missing or not an object rather than throwing", () => {
    const broken = lesson({
      grammar: [{ category: "negation", title: "t", explanation: "e", examples: [undefined as never, "not a line" as never] }],
      dialogue: [undefined as never, { speaker: "B", ...line("تفضل") }],
    });
    const issues = validateTrack(track([broken]), MINI_SYLLABUS, new Map(), { allowPartial: true });
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("grammar[0].examples[0]: missing"),
        expect.stringContaining("grammar[0].examples[1]: missing"),
        expect.stringContaining("dialogue[0]: missing"),
        expect.stringContaining("dialogue[0]: speaker missing"),
      ]),
    );
  });

  it("holds a lesson to the shared rules even when the syllabus has no slot for it", () => {
    // allowPartial lets an unknown slug through with one complaint; everything
    // else about the lesson is still checked, and the concept and grammar
    // checks that need a slot simply do not fire.
    const issues = validateTrack(
      track([lesson({ slug: "extra", vocabulary: [word("ماي", "water"), word("قهوة", "coffee")] })]),
      MINI_SYLLABUS,
      new Map(),
      { allowPartial: true },
    );
    expect(issues).toEqual([expect.stringContaining("not in the syllabus: extra")]);
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
