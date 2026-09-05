/**
 * Curriculum tracks — the source of truth for the authored Stage 1–3 syllabus
 * in every dialect.
 *
 * One dialect-neutral syllabus (`curriculum/tracks/syllabus.json`) fixes the
 * lesson slots: slug, order, CEFR target, can-do goals, grammar targets, the
 * cultural thread and the concepts every dialect has to realise. Each dialect
 * then fills those slots in its own words (`curriculum/tracks/<dialect>/
 * stage-<n>.json`). Same shape as the clip pipeline's `vocab_concepts` →
 * `concept_realizations`: lessons line up across dialects by slug and concept
 * key, never by an Arabic string, so one syllabus drives three tracks and a
 * learner switching dialect lands on the same lesson.
 *
 * This module is pure so Vitest can hold the JSON to it
 * (`src/test/curriculumTracks.test.ts`) and so the seed generator
 * (`src/lib/curriculumSeed.ts`) and the video-needs manifest builder can share
 * the types. It never reads the disk.
 */

export const TRACK_DIALECTS = ["Gulf", "Egyptian", "Yemeni"] as const;
export type TrackDialect = (typeof TRACK_DIALECTS)[number];

/** Mirrors GRAMMAR_CATEGORY_IDS in supabase/functions/_shared/grammarTaxonomy.ts. */
export const TRACK_GRAMMAR_CATEGORIES = [
  "verb-conjugation",
  "pronouns",
  "negation",
  "possessives",
  "questions",
  "sentence-structure",
] as const;
export type TrackGrammarCategory = (typeof TRACK_GRAMMAR_CATEGORIES)[number];

export interface ArabicLine {
  arabic: string;
  transliteration: string;
  english: string;
}

export interface SyllabusConcept {
  /** Stable snake_case English key, shared with vocab_concepts where one exists. */
  key: string;
  gloss: string;
}

export interface SyllabusGrammarTarget {
  category: TrackGrammarCategory;
  point: string;
}

export interface SyllabusLesson {
  slug: string;
  lesson_number: number;
  title: string;
  theme: string;
  cefr_target: string;
  can_do: string[];
  grammar: SyllabusGrammarTarget[];
  culture: string;
  target_concepts: SyllabusConcept[];
  /** What a clip for this lesson should show — guidance for video hunting. */
  video_scene: string;
}

export interface SyllabusStage {
  stage: number;
  name: string;
  cefr: string;
  /** Minimum new words per lesson in this stage. */
  words_per_lesson: number;
  lessons: SyllabusLesson[];
}

export interface Syllabus {
  version: number;
  stages: SyllabusStage[];
}

export interface TrackGrammarNote {
  category: TrackGrammarCategory;
  title: string;
  explanation: string;
  examples: ArabicLine[];
}

export interface TrackCultureNote {
  title: string;
  note: string;
  phrases: ArabicLine[];
}

export interface TrackVocabulary {
  arabic: string;
  transliteration: string;
  english: string;
  /** Part of speech or theme — free text, shown in admin tooling. */
  category: string;
  teaching_note: string;
  image_scene: string;
  /** Set when this word realises a syllabus concept (or any vocab_concepts key). */
  concept_key?: string;
  /** Spelling / definite / plural variants the clip miner should also match. */
  variants?: string[];
  example: ArabicLine;
  /** What to look for in a video — the object shown, the action, the phrase context. */
  video_hint?: string;
}

export interface TrackDialogueLine extends ArabicLine {
  speaker: string;
}

export interface SoundSpotlightEntry {
  sound: string;
  example: string;
  explanation: string;
}

export interface TrackSequenceStep {
  step: string;
  detail: string;
}

export interface TrackRealWorldPrompt {
  prompt: string;
  context: string;
}

export interface TrackVideoNeeds {
  /** Arabic-script YouTube search queries. */
  queries: string[];
  /** Names from content_channels worth mining first. */
  channels: string[];
  /** The scene a clip should show. */
  scene: string;
}

export interface TrackLesson {
  slug: string;
  lesson_number: number;
  title: string;
  title_arabic: string;
  description: string;
  cefr_target: string;
  duration_minutes: number;
  approach: string;
  unlock_condition: string;
  icon: string;
  can_do: string[];
  grammar: TrackGrammarNote[];
  culture: TrackCultureNote[];
  vocabulary: TrackVocabulary[];
  dialogue: TrackDialogueLine[];
  sound_spotlight: SoundSpotlightEntry[];
  lesson_sequence: TrackSequenceStep[];
  real_world_prompts: TrackRealWorldPrompt[];
  video_needs: TrackVideoNeeds;
}

export interface Track {
  dialect: TrackDialect;
  stage: number;
  /** The sub-variety the track is written in, e.g. "Cairene", "Ṣanʿāni". */
  variety: string;
  lessons: TrackLesson[];
}

/** `dialect/s<stage>/l<nn>` — the lessons.source_key the seed upserts on. */
export function lessonSourceKey(dialect: TrackDialect, stage: number, lessonNumber: number): string {
  return `${dialect.toLowerCase()}/s${stage}/l${String(lessonNumber).padStart(2, "0")}`;
}

const ARABIC_LETTER = /[ء-ي٠-٩ٱ-ۓ]/;
const LATIN_LETTER = /[A-Za-z]/;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function checkLine(line: ArabicLine | undefined, path: string, issues: string[]): void {
  if (!line || typeof line !== "object") {
    issues.push(`${path}: missing`);
    return;
  }
  if (!nonEmpty(line.arabic) || !ARABIC_LETTER.test(line.arabic)) {
    issues.push(`${path}.arabic: must contain Arabic script`);
  }
  if (!nonEmpty(line.transliteration) || ARABIC_LETTER.test(line.transliteration)) {
    issues.push(`${path}.transliteration: must be Latin transliteration`);
  }
  if (!nonEmpty(line.english) || !LATIN_LETTER.test(line.english)) {
    issues.push(`${path}.english: must be an English gloss`);
  }
}

/** Every syllabus lesson, flattened, with its stage. */
export function syllabusLessons(syllabus: Syllabus): Array<SyllabusLesson & { stage: SyllabusStage }> {
  return syllabus.stages.flatMap((stage) => stage.lessons.map((lesson) => ({ ...lesson, stage })));
}

/**
 * Structural checks on the syllabus itself: contiguous numbering, unique
 * slugs, unique concept keys within a lesson, valid grammar categories.
 */
export function validateSyllabus(syllabus: Syllabus): string[] {
  const issues: string[] = [];
  const slugs = new Set<string>();
  const stageNumbers = new Set<number>();
  for (const stage of syllabus.stages) {
    if (stageNumbers.has(stage.stage)) issues.push(`stage ${stage.stage}: duplicated`);
    stageNumbers.add(stage.stage);
    if (!(stage.words_per_lesson > 0)) issues.push(`stage ${stage.stage}: words_per_lesson must be positive`);
    stage.lessons.forEach((lesson, i) => {
      const path = `stage ${stage.stage} lesson ${lesson.slug}`;
      if (lesson.lesson_number !== i + 1) issues.push(`${path}: lesson_number ${lesson.lesson_number}, expected ${i + 1}`);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(lesson.slug)) issues.push(`${path}: slug must be kebab-case`);
      if (slugs.has(lesson.slug)) issues.push(`${path}: slug duplicated`);
      slugs.add(lesson.slug);
      if (!nonEmpty(lesson.title)) issues.push(`${path}: title missing`);
      if (!nonEmpty(lesson.cefr_target)) issues.push(`${path}: cefr_target missing`);
      if (!Array.isArray(lesson.can_do) || lesson.can_do.length === 0) issues.push(`${path}: can_do empty`);
      for (const g of lesson.grammar ?? []) {
        if (!TRACK_GRAMMAR_CATEGORIES.includes(g.category)) issues.push(`${path}: unknown grammar category ${g.category}`);
      }
      const keys = new Set<string>();
      for (const c of lesson.target_concepts ?? []) {
        if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(c.key)) issues.push(`${path}: concept key ${c.key} must be snake_case`);
        if (keys.has(c.key)) issues.push(`${path}: concept ${c.key} duplicated`);
        keys.add(c.key);
      }
      if (keys.size === 0) issues.push(`${path}: no target concepts`);
      if (!nonEmpty(lesson.video_scene)) issues.push(`${path}: video_scene missing`);
    });
  }
  return issues;
}

/**
 * Hold one dialect's stage file to the syllabus.
 *
 * Errors (not warnings) on: a lesson slot missing or out of order, a target
 * concept with no realisation, fewer new words than the stage minimum, a word
 * introduced twice in the same dialect, a grammar note outside the six shared
 * categories, and any Arabic/transliteration/English field that is empty or in
 * the wrong script. `seenArabic` lets a caller thread one set through every
 * stage of a dialect so cross-stage duplicates are caught too.
 */
export interface ValidateOptions {
  /**
   * Accept a stage with lesson slots still unwritten. Each lesson present must
   * still sit in its own slot; only the completeness check is relaxed. For
   * authors mid-way through a stage — CI never sets it.
   */
  allowPartial?: boolean;
}

export function validateTrack(
  track: Track,
  syllabus: Syllabus,
  seenArabic: Map<string, string> = new Map(),
  options: ValidateOptions = {},
): string[] {
  const issues: string[] = [];
  if (!TRACK_DIALECTS.includes(track.dialect)) {
    issues.push(`dialect ${String(track.dialect)} is not one of ${TRACK_DIALECTS.join(", ")}`);
    return issues;
  }
  const stage = syllabus.stages.find((s) => s.stage === track.stage);
  if (!stage) {
    issues.push(`stage ${track.stage} is not in the syllabus`);
    return issues;
  }
  const prefix = `${track.dialect} stage ${track.stage}`;
  if (!nonEmpty(track.variety)) issues.push(`${prefix}: variety missing`);

  const expected = stage.lessons.map((l) => l.slug);
  const actual = (track.lessons ?? []).map((l) => l.slug);
  if (options.allowPartial) {
    const unknown = actual.filter((slug) => !expected.includes(slug));
    if (unknown.length > 0) issues.push(`${prefix}: slugs not in the syllabus: ${unknown.join(", ")}`);
    const order = actual.filter((slug) => expected.includes(slug)).map((slug) => expected.indexOf(slug));
    if (order.some((n, i) => i > 0 && n <= order[i - 1])) issues.push(`${prefix}: lessons out of syllabus order`);
  } else if (expected.join("|") !== actual.join("|")) {
    issues.push(`${prefix}: lesson slugs must be exactly [${expected.join(", ")}] in order; got [${actual.join(", ")}]`);
  }

  for (const lesson of track.lessons ?? []) {
    const slot = stage.lessons.find((l) => l.slug === lesson.slug);
    const path = `${prefix} ${lesson.slug}`;
    if (slot && lesson.lesson_number !== slot.lesson_number) {
      issues.push(`${path}: lesson_number ${lesson.lesson_number} != syllabus ${slot.lesson_number}`);
    }
    for (const field of ["title", "title_arabic", "description", "cefr_target", "approach", "unlock_condition", "icon"] as const) {
      if (!nonEmpty(lesson[field])) issues.push(`${path}: ${field} missing`);
    }
    if (nonEmpty(lesson.title_arabic) && !ARABIC_LETTER.test(lesson.title_arabic)) {
      issues.push(`${path}: title_arabic must be Arabic script`);
    }
    if (!(lesson.duration_minutes > 0)) issues.push(`${path}: duration_minutes must be positive`);
    if (!Array.isArray(lesson.can_do) || lesson.can_do.length === 0) issues.push(`${path}: can_do empty`);

    (lesson.grammar ?? []).forEach((g, i) => {
      const gp = `${path}.grammar[${i}]`;
      if (!TRACK_GRAMMAR_CATEGORIES.includes(g.category)) issues.push(`${gp}: unknown category ${g.category}`);
      if (!nonEmpty(g.title)) issues.push(`${gp}: title missing`);
      if (!nonEmpty(g.explanation)) issues.push(`${gp}: explanation missing`);
      if (!Array.isArray(g.examples) || g.examples.length === 0) issues.push(`${gp}: needs examples`);
      (g.examples ?? []).forEach((ex, j) => checkLine(ex, `${gp}.examples[${j}]`, issues));
    });
    if (slot && slot.grammar.length > 0 && (lesson.grammar ?? []).length === 0) {
      issues.push(`${path}: syllabus targets grammar but the lesson has no grammar notes`);
    }

    (lesson.culture ?? []).forEach((c, i) => {
      const cp = `${path}.culture[${i}]`;
      if (!nonEmpty(c.title)) issues.push(`${cp}: title missing`);
      if (!nonEmpty(c.note)) issues.push(`${cp}: note missing`);
      (c.phrases ?? []).forEach((ph, j) => checkLine(ph, `${cp}.phrases[${j}]`, issues));
    });
    if ((lesson.culture ?? []).length === 0) issues.push(`${path}: culture notes missing`);

    const words = lesson.vocabulary ?? [];
    if (words.length < stage.words_per_lesson) {
      issues.push(`${path}: ${words.length} words, stage minimum is ${stage.words_per_lesson}`);
    }
    const inLesson = new Set<string>();
    const realised = new Set<string>();
    words.forEach((w, i) => {
      const wp = `${path}.vocabulary[${i}]`;
      checkLine(w, wp, issues);
      if (!nonEmpty(w.category)) issues.push(`${wp}: category missing`);
      if (!nonEmpty(w.teaching_note)) issues.push(`${wp}: teaching_note missing`);
      if (!nonEmpty(w.image_scene)) issues.push(`${wp}: image_scene missing`);
      checkLine(w.example, `${wp}.example`, issues);
      if (w.concept_key !== undefined) {
        if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(w.concept_key)) issues.push(`${wp}: concept_key must be snake_case`);
        if (realised.has(w.concept_key)) issues.push(`${wp}: concept ${w.concept_key} realised twice in one lesson`);
        realised.add(w.concept_key);
      }
      for (const v of w.variants ?? []) {
        if (!ARABIC_LETTER.test(v)) issues.push(`${wp}: variant ${JSON.stringify(v)} must be Arabic script`);
      }
      const key = nonEmpty(w.arabic) ? w.arabic.trim() : "";
      if (key) {
        if (inLesson.has(key)) issues.push(`${wp}: ${key} listed twice in this lesson`);
        inLesson.add(key);
        const earlier = seenArabic.get(key);
        if (earlier && earlier !== lesson.slug) issues.push(`${wp}: ${key} already introduced in ${earlier}`);
        seenArabic.set(key, lesson.slug);
      }
    });
    for (const concept of slot?.target_concepts ?? []) {
      if (!realised.has(concept.key)) issues.push(`${path}: target concept ${concept.key} (${concept.gloss}) has no word`);
    }

    (lesson.dialogue ?? []).forEach((line, i) => {
      checkLine(line, `${path}.dialogue[${i}]`, issues);
      if (!nonEmpty(line.speaker)) issues.push(`${path}.dialogue[${i}]: speaker missing`);
    });
    if ((lesson.dialogue ?? []).length < 2) issues.push(`${path}: dialogue needs at least two lines`);

    (lesson.sound_spotlight ?? []).forEach((s, i) => {
      if (!nonEmpty(s.sound)) issues.push(`${path}.sound_spotlight[${i}]: sound missing`);
      if (!nonEmpty(s.explanation)) issues.push(`${path}.sound_spotlight[${i}]: explanation missing`);
    });
    (lesson.lesson_sequence ?? []).forEach((s, i) => {
      if (!nonEmpty(s.step) || !nonEmpty(s.detail)) issues.push(`${path}.lesson_sequence[${i}]: step and detail required`);
    });
    if ((lesson.lesson_sequence ?? []).length === 0) issues.push(`${path}: lesson_sequence missing`);
    (lesson.real_world_prompts ?? []).forEach((p, i) => {
      if (!nonEmpty(p.prompt) || !nonEmpty(p.context)) issues.push(`${path}.real_world_prompts[${i}]: prompt and context required`);
    });
    if ((lesson.real_world_prompts ?? []).length === 0) issues.push(`${path}: real_world_prompts missing`);

    const vn = lesson.video_needs;
    if (!vn || !Array.isArray(vn.queries) || vn.queries.length === 0) issues.push(`${path}: video_needs.queries missing`);
    else vn.queries.forEach((q, i) => { if (!ARABIC_LETTER.test(q)) issues.push(`${path}.video_needs.queries[${i}]: should be an Arabic-script search`); });
    if (!vn || !nonEmpty(vn.scene)) issues.push(`${path}: video_needs.scene missing`);
  }
  return issues;
}

export interface ArabicSample {
  path: string;
  text: string;
}

/** Every piece of Arabic a lesson ships, for the MSA-leak detector. */
export function arabicSamples(track: Track): ArabicSample[] {
  const out: ArabicSample[] = [];
  for (const lesson of track.lessons) {
    const p = `${track.dialect}/s${track.stage}/${lesson.slug}`;
    out.push({ path: `${p}.title_arabic`, text: lesson.title_arabic });
    lesson.grammar.forEach((g, i) => g.examples.forEach((ex, j) => out.push({ path: `${p}.grammar[${i}].examples[${j}]`, text: ex.arabic })));
    lesson.culture.forEach((c, i) => c.phrases.forEach((ph, j) => out.push({ path: `${p}.culture[${i}].phrases[${j}]`, text: ph.arabic })));
    lesson.vocabulary.forEach((w, i) => {
      out.push({ path: `${p}.vocabulary[${i}]`, text: w.arabic });
      out.push({ path: `${p}.vocabulary[${i}].example`, text: w.example.arabic });
    });
    lesson.dialogue.forEach((d, i) => out.push({ path: `${p}.dialogue[${i}]`, text: d.arabic }));
  }
  return out;
}

/** Word count per stage and in total for one dialect. */
export function trackWordCounts(tracks: Track[]): { byStage: Record<number, number>; total: number } {
  const byStage: Record<number, number> = {};
  let total = 0;
  for (const t of tracks) {
    const n = t.lessons.reduce((acc, l) => acc + l.vocabulary.length, 0);
    byStage[t.stage] = (byStage[t.stage] ?? 0) + n;
    total += n;
  }
  return { byStage, total };
}
