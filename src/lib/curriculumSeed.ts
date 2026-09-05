/**
 * Compile curriculum tracks into the seed migration.
 *
 * Pure: takes the syllabus and the loaded tracks, returns SQL. The disk half is
 * scripts/build-curriculum-seed.ts; src/test/curriculumSeed.test.ts regenerates
 * the SQL from the JSON and fails when the committed migration is stale, so
 * the tracks and the database can never quietly disagree.
 *
 * What the seed writes, and why it is shaped the way it is:
 *
 *   lessons            upsert on lessons.source_key. Re-running a regenerated
 *                      seed updates a lesson in place; learner progress keyed
 *                      on the lesson id survives.
 *   vocabulary_words   insert-if-missing on (lesson_id, word_arabic), then an
 *                      update of the authored fields. Never a delete: word ids
 *                      are what word_reviews and user_vocabulary point at.
 *   curriculum_concepts one grammar concept per (category, dialect) the tracks
 *                      teach, linked to each lesson that introduces it, so the
 *                      coverage planner and grammar mastery see the tracks.
 *   vocab_concepts /   every word with a concept_key becomes a draft
 *   concept_realizations realisation the clip miner can hunt for in captions —
 *                      the paper trail from a lesson word to a video.
 *
 * Every string is dollar-quoted with a tag no content contains, so Arabic,
 * quotes and backslashes need no escaping and the file stays readable.
 */
import {
  TRACK_GRAMMAR_CATEGORIES,
  lessonSourceKey,
  syllabusLessons,
  type Syllabus,
  type Track,
  type TrackLesson,
} from "./curriculumTracks";

export const SEED_MIGRATION_NAME = "20260905110000_seed_curriculum_tracks";

const TAG = "$hk$";

export function sqlString(value: string): string {
  if (value.includes(TAG)) throw new Error(`content contains the quoting tag ${TAG}: ${value}`);
  return `${TAG}${value}${TAG}`;
}

function sqlJson(value: unknown): string {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

function sqlTextArray(values: string[]): string {
  if (values.length === 0) return "'{}'::text[]";
  return `ARRAY[${values.map(sqlString).join(", ")}]::text[]`;
}

const GRADIENTS = [
  "bg-gradient-green",
  "bg-gradient-sand",
  "bg-gradient-olive",
  "bg-gradient-indigo",
  "bg-gradient-warm",
  "bg-gradient-charcoal",
  "bg-gradient-red",
];

const GRAMMAR_DISPLAY: Record<(typeof TRACK_GRAMMAR_CATEGORIES)[number], string> = {
  "verb-conjugation": "Verb conjugation",
  pronouns: "Pronouns",
  negation: "Negation",
  possessives: "Possessives",
  questions: "Questions",
  "sentence-structure": "Sentence structure",
};

/** Lesson display order that sorts across stages: 101, 102, … 201, 202, … */
export function lessonDisplayOrder(stage: number, lessonNumber: number): number {
  return stage * 100 + lessonNumber;
}

function lessonUpsert(track: Track, lesson: TrackLesson): string {
  const key = lessonSourceKey(track.dialect, track.stage, lesson.lesson_number);
  const gradient = GRADIENTS[(lesson.lesson_number - 1) % GRADIENTS.length];
  const cols = {
    source_key: sqlString(key),
    lesson_number: String(lesson.lesson_number),
    title: sqlString(lesson.title),
    title_arabic: sqlString(lesson.title_arabic),
    description: sqlString(lesson.description),
    duration_minutes: String(lesson.duration_minutes),
    cefr_target: sqlString(lesson.cefr_target),
    approach: sqlString(lesson.approach),
    unlock_condition: sqlString(lesson.unlock_condition),
    icon: sqlString(lesson.icon),
    gradient: sqlString(gradient),
    display_order: String(lessonDisplayOrder(track.stage, lesson.lesson_number)),
    dialect_module: sqlString(track.dialect),
    status: "'published'",
    can_do: sqlJson(lesson.can_do),
    grammar_notes: sqlJson(lesson.grammar),
    culture_notes: sqlJson(lesson.culture),
    dialogue: sqlJson(lesson.dialogue),
    sound_spotlight: sqlJson(lesson.sound_spotlight),
    lesson_sequence: sqlJson(lesson.lesson_sequence),
    real_world_prompts: sqlJson(lesson.real_world_prompts),
  };
  const names = Object.keys(cols);
  const updates = names
    .filter((n) => n !== "source_key")
    .map((n) => `${n} = EXCLUDED.${n}`)
    .join(", ");
  return [
    `INSERT INTO public.lessons (stage_id, ${names.join(", ")})`,
    `SELECT s.id, ${names.map((n) => cols[n as keyof typeof cols]).join(", ")}`,
    `FROM public.curriculum_stages s WHERE s.stage_number = ${track.stage}`,
    `ON CONFLICT (source_key) DO UPDATE SET ${updates}, stage_id = EXCLUDED.stage_id;`,
  ].join("\n");
}

function wordsStatements(track: Track, lesson: TrackLesson): string {
  const key = lessonSourceKey(track.dialect, track.stage, lesson.lesson_number);
  const rows = lesson.vocabulary.map((w, i) =>
    `(${[
      sqlString(w.arabic),
      sqlString(w.english),
      sqlString(w.transliteration),
      sqlString(w.category),
      sqlString(w.teaching_note),
      sqlString(w.image_scene),
      sqlString(w.example.arabic),
      sqlString(w.example.transliteration),
      sqlString(w.example.english),
      String(i + 1),
    ].join(", ")})`,
  );
  const values = `(VALUES\n  ${rows.join(",\n  ")}\n) AS v(word_arabic, word_english, transliteration, category, teaching_note, image_scene_description, example_arabic, example_transliteration, example_english, display_order)`;
  const insert = [
    "INSERT INTO public.vocabulary_words (lesson_id, dialect_module, word_arabic, word_english, transliteration, category, teaching_note, image_scene_description, example_arabic, example_transliteration, example_english, display_order)",
    `SELECT l.id, ${sqlString(track.dialect)}, v.word_arabic, v.word_english, v.transliteration, v.category, v.teaching_note, v.image_scene_description, v.example_arabic, v.example_transliteration, v.example_english, v.display_order`,
    `FROM ${values}`,
    `CROSS JOIN public.lessons l`,
    `WHERE l.source_key = ${sqlString(key)}`,
    "  AND NOT EXISTS (SELECT 1 FROM public.vocabulary_words w WHERE w.lesson_id = l.id AND w.word_arabic = v.word_arabic);",
  ].join("\n");
  const update = [
    "UPDATE public.vocabulary_words w",
    "SET word_english = v.word_english, transliteration = v.transliteration, category = v.category, teaching_note = v.teaching_note, image_scene_description = v.image_scene_description, example_arabic = v.example_arabic, example_transliteration = v.example_transliteration, example_english = v.example_english, display_order = v.display_order",
    `FROM ${values}, public.lessons l`,
    `WHERE l.source_key = ${sqlString(key)} AND w.lesson_id = l.id AND w.word_arabic = v.word_arabic;`,
  ].join("\n");
  return `${insert}\n${update}`;
}

function grammarStatements(track: Track, lesson: TrackLesson): string {
  const key = lessonSourceKey(track.dialect, track.stage, lesson.lesson_number);
  const categories = [...new Set(lesson.grammar.map((g) => g.category))];
  return categories
    .map((category) =>
      [
        "INSERT INTO public.curriculum_concepts (kind, key, dialect, display_english, cefr_level, stage_id, source_type, metadata)",
        `SELECT 'grammar', ${sqlString(category)}, ${sqlString(track.dialect)}, ${sqlString(GRAMMAR_DISPLAY[category])}, ${sqlString(lesson.cefr_target)}, s.id, 'curriculum-tracks', '{}'::jsonb`,
        `FROM public.curriculum_stages s WHERE s.stage_number = ${track.stage}`,
        "ON CONFLICT (kind, key, dialect) DO NOTHING;",
        "INSERT INTO public.content_concept_links (concept_id, content_type, content_id, role)",
        "SELECT c.id, 'lesson', l.id, 'introduce'",
        "FROM public.curriculum_concepts c, public.lessons l",
        `WHERE c.kind = 'grammar' AND c.key = ${sqlString(category)} AND c.dialect = ${sqlString(track.dialect)} AND l.source_key = ${sqlString(key)}`,
        "ON CONFLICT (concept_id, content_type, content_id, role) DO NOTHING;",
      ].join("\n"),
    )
    .join("\n");
}

function conceptStatements(syllabus: Syllabus, track: Track, lesson: TrackLesson): string {
  const slot = syllabusLessons(syllabus).find((l) => l.slug === lesson.slug);
  const theme = (slot?.theme ?? lesson.slug).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const out: string[] = [];
  lesson.vocabulary.forEach((w, i) => {
    if (!w.concept_key) return;
    const gloss = slot?.target_concepts.find((c) => c.key === w.concept_key)?.gloss ?? w.english;
    const cefr = /^(A1|A2|B1|B2|C1|C2)$/.test(lesson.cefr_target) ? lesson.cefr_target : "A1";
    const sortOrder = 10000 + lessonDisplayOrder(track.stage, lesson.lesson_number) * 100 + i;
    out.push(
      [
        "INSERT INTO public.vocab_concepts (key, english_gloss, category, cefr_level, sort_order)",
        `VALUES (${sqlString(w.concept_key)}, ${sqlString(gloss)}, ${sqlString(theme)}, ${sqlString(cefr)}, ${sortOrder})`,
        "ON CONFLICT (key) DO NOTHING;",
        "INSERT INTO public.concept_realizations (concept_id, dialect, surface, variants, phonetic, status, source)",
        `SELECT c.id, ${sqlString(track.dialect)}, ${sqlString(w.arabic)}, ${sqlTextArray(w.variants ?? [])}, ${sqlString(w.transliteration)}, 'draft', 'curriculum-tracks'`,
        `FROM public.vocab_concepts c WHERE c.key = ${sqlString(w.concept_key)}`,
        "ON CONFLICT (concept_id, dialect, surface) DO NOTHING;",
      ].join("\n"),
    );
  });
  return out.join("\n");
}

/** The whole seed migration for the given tracks, deterministic in track order. */
export function buildSeedSql(syllabus: Syllabus, tracks: Track[]): string {
  const ordered = [...tracks].sort((a, b) => a.dialect.localeCompare(b.dialect) || a.stage - b.stage);
  const lessonCount = ordered.reduce((n, t) => n + t.lessons.length, 0);
  const wordCount = ordered.reduce((n, t) => n + t.lessons.reduce((m, l) => m + l.vocabulary.length, 0), 0);
  const parts: string[] = [
    "-- GENERATED FILE — do not edit by hand.",
    "--",
    "-- Compiled from curriculum/tracks/ by scripts/build-curriculum-seed.ts.",
    "-- src/test/curriculumSeed.test.ts fails when this file is stale; regenerate with",
    "--   npx vite-node scripts/build-curriculum-seed.ts",
    "--",
    `-- ${ordered.length} track(s), ${lessonCount} lessons, ${wordCount} words. Idempotent: lessons upsert on`,
    "-- source_key, words insert-if-missing then update, concepts insert-if-missing.",
    "-- Schema it relies on: 20260905100000_curriculum_tracks_schema.sql.",
    "",
    "BEGIN;",
  ];
  for (const track of ordered) {
    parts.push("", `-- ============ ${track.dialect} · Stage ${track.stage} · ${track.variety} ============`);
    for (const lesson of track.lessons) {
      parts.push("", `-- ${lessonSourceKey(track.dialect, track.stage, lesson.lesson_number)} · ${lesson.title}`);
      parts.push(lessonUpsert(track, lesson));
      parts.push(wordsStatements(track, lesson));
      const grammar = grammarStatements(track, lesson);
      if (grammar) parts.push(grammar);
      const concepts = conceptStatements(syllabus, track, lesson);
      if (concepts) parts.push(concepts);
    }
  }
  parts.push("", "COMMIT;", "");
  return parts.join("\n");
}
