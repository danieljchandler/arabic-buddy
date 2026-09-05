import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SEED_MIGRATION_NAME, buildSeedSql, lessonDisplayOrder, sqlString } from "@/lib/curriculumSeed";
import type { Syllabus, Track } from "@/lib/curriculumTracks";
import { loadAllTracks, loadSyllabus } from "../../scripts/curriculum/loadTracks";

/**
 * The seed migration is generated from curriculum/tracks/ and committed. This
 * regenerates it and compares, so the JSON (which authors edit) and the SQL
 * (which the database runs) cannot drift apart: edit a lesson, forget to run
 * `npx vite-node scripts/build-curriculum-seed.ts`, and this goes red.
 */

const MIGRATION = resolve(__dirname, `../../supabase/migrations/${SEED_MIGRATION_NAME}.sql`);

describe("seed migration", () => {
  it("is exactly what the tracks compile to", () => {
    expect(existsSync(MIGRATION), `${MIGRATION} missing — run scripts/build-curriculum-seed.ts`).toBe(true);
    const expected = buildSeedSql(loadSyllabus(), loadAllTracks());
    expect(readFileSync(MIGRATION, "utf8")).toBe(expected);
  });
});

const syllabus: Syllabus = {
  version: 1,
  stages: [
    {
      stage: 2,
      name: "Building Blocks",
      cefr: "A1 → A2",
      words_per_lesson: 1,
      lessons: [
        {
          slug: "negation",
          lesson_number: 3,
          title: "Negation",
          theme: "Saying no",
          cefr_target: "A1",
          can_do: ["Say no"],
          grammar: [{ category: "negation", point: "ما" }],
          culture: "Refusal.",
          target_concepts: [{ key: "not", gloss: "not (before nouns)" }],
          video_scene: "Someone declining.",
        },
      ],
    },
  ],
};

const track: Track = {
  dialect: "Egyptian",
  stage: 2,
  variety: "Cairene",
  lessons: [
    {
      slug: "negation",
      lesson_number: 3,
      title: "Saying No",
      title_arabic: "لأ",
      description: "It's a 'no' lesson",
      cefr_target: "A1",
      duration_minutes: 20,
      approach: "patterns",
      unlock_condition: "8/10",
      icon: "🚫",
      can_do: ["Say no"],
      grammar: [
        { category: "negation", title: "مش", explanation: "before nouns", examples: [{ arabic: "مش عايز", transliteration: "mish ʿaayiz", english: "I don't want" }] },
        { category: "negation", title: "ما…ش", explanation: "around verbs", examples: [{ arabic: "ماعرفش", transliteration: "maʿrafsh", english: "I don't know" }] },
      ],
      culture: [{ title: "Three refusals", note: "Say no first.", phrases: [] }],
      vocabulary: [
        {
          arabic: "مش",
          transliteration: "mish",
          english: "not",
          category: "particle",
          teaching_note: "Before nouns and adjectives.",
          image_scene: "A crossed-out cup.",
          concept_key: "not",
          variants: ["مِش", "موش"],
          example: { arabic: "مش كويس", transliteration: "mish kwayyis", english: "not good" },
        },
        {
          arabic: "خالص",
          transliteration: "khaaliṣ",
          english: "at all",
          category: "adverb",
          teaching_note: "Intensifies a negative.",
          image_scene: "An empty plate.",
          example: { arabic: "مفيش خالص", transliteration: "mafiish khaaliṣ", english: "there's none at all" },
        },
      ],
      dialogue: [{ speaker: "A", arabic: "عايز شاي؟", transliteration: "ʿaayiz shaay?", english: "Want tea?" }],
      sound_spotlight: [],
      lesson_sequence: [{ step: "Listen", detail: "contrast pairs" }],
      real_world_prompts: [{ prompt: "Refuse something today", context: "politely" }],
      video_needs: { queries: ["مش عايز"], channels: [], scene: "declining" },
    },
  ],
};

describe("buildSeedSql", () => {
  const sql = buildSeedSql(syllabus, [track]);

  it("upserts the lesson on its source key with the track's dialect", () => {
    expect(sql).toContain("$hk$egyptian/s2/l03$hk$");
    expect(sql).toContain("ON CONFLICT (source_key) DO UPDATE SET");
    expect(sql).toContain("FROM public.curriculum_stages s WHERE s.stage_number = 2");
    expect(sql).toContain("$hk$Egyptian$hk$");
    expect(sql).toContain(`${lessonDisplayOrder(2, 3)}`);
    // The JSONB sections travel whole.
    expect(sql).toContain(JSON.stringify(track.lessons[0].grammar));
    expect(sql).toContain(JSON.stringify(track.lessons[0].culture));
  });

  it("never deletes words: insert-if-missing, then update in place", () => {
    expect(sql).not.toMatch(/DELETE/i);
    expect(sql).toContain("AND NOT EXISTS (SELECT 1 FROM public.vocabulary_words w WHERE w.lesson_id = l.id AND w.word_arabic = v.word_arabic)");
    expect(sql).toContain("UPDATE public.vocabulary_words w");
    expect(sql).toContain("$hk$مش كويس$hk$");
  });

  it("registers one grammar concept per category and links the lesson to it", () => {
    // Two negation notes, one concept.
    expect(sql.match(/INSERT INTO public\.curriculum_concepts/g)).toHaveLength(1);
    expect(sql).toContain("'grammar', $hk$negation$hk$, $hk$Egyptian$hk$, $hk$Negation$hk$, $hk$A1$hk$");
    expect(sql).toContain("INSERT INTO public.content_concept_links (concept_id, content_type, content_id, role)");
  });

  it("drafts a clip-miner realisation only for words with a concept key", () => {
    expect(sql.match(/INSERT INTO public\.concept_realizations/g)).toHaveLength(1);
    expect(sql).toContain("VALUES ($hk$not$hk$, $hk$not (before nouns)$hk$, $hk$saying_no$hk$, $hk$A1$hk$,");
    expect(sql).toContain("ARRAY[$hk$مِش$hk$, $hk$موش$hk$]::text[]");
    expect(sql).not.toContain("$hk$خالص$hk$, ARRAY");
  });

  it("orders tracks deterministically and wraps everything in one transaction", () => {
    const gulf: Track = { ...track, dialect: "Gulf" };
    const twice = buildSeedSql(syllabus, [gulf, track]);
    expect(twice.indexOf("Egyptian · Stage 2")).toBeLessThan(twice.indexOf("Gulf · Stage 2"));
    expect(twice.startsWith("-- GENERATED FILE")).toBe(true);
    expect(twice).toContain("\nBEGIN;\n");
    expect(twice.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("falls back to A1 for a CEFR label vocab_concepts cannot store, and to the word's gloss for an unlisted concept", () => {
    const pre: Track = JSON.parse(JSON.stringify(track));
    pre.lessons[0].cefr_target = "Pre-A1";
    pre.lessons[0].vocabulary[1].concept_key = "at_all";
    pre.lessons[0].vocabulary[0].variants = undefined;
    const out = buildSeedSql(syllabus, [pre]);
    expect(out).toContain("$hk$at_all$hk$, $hk$at all$hk$, $hk$saying_no$hk$, $hk$A1$hk$");
    expect(out).toContain("'{}'::text[]");
  });
});

describe("sqlString", () => {
  it("dollar-quotes so Arabic, quotes and backslashes need no escaping", () => {
    expect(sqlString(`it's "fine" \\ ماي`)).toBe(`$hk$it's "fine" \\ ماي$hk$`);
  });

  it("refuses content that would close the quote early", () => {
    expect(() => sqlString("a $hk$ b")).toThrow(/quoting tag/);
  });
});
