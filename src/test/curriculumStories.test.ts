import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { installSupabaseFetch } from "./support/transports/vitest";
import { SUPABASE_URL, type SupabaseBackend } from "./support/server/handler";
import {
  aLesson,
  anAuthenticStory,
  anAuthenticStoryLine,
  aStage,
  aVocabularyWord,
  lessonId,
  stageId,
  storyId,
  storyLineId,
  wordId,
} from "./support/factories";
import { detectMsaLeaks } from "../../supabase/functions/_shared/msaLeakDetector";
import type { StoryClient } from "../../supabase/functions/_shared/wordStoryLine";
import type { WordAssetClient } from "../../supabase/functions/_shared/wordAssets";
import {
  describeShelf,
  formatStorySummary,
  MAX_CONSECUTIVE_FAILURES,
  planStoryWords,
  runStories,
  STORE_MISSING,
  storyRunFailed,
  type AssetRowDeleter,
  type StoryOptions,
  type StoryRunContext,
} from "../../scripts/curriculum-stories-core.ts";

/**
 * `scripts/curriculum-stories.ts`, the tool that gives the curriculum its
 * story passages from the reading library (quiz Phase 6), driven against the
 * in-memory project.
 *
 * It calls no model and charges nobody, so what must not go wrong is what it
 * writes: a dry run that writes anything, a passage cut from a story the
 * source rule turns away (a draft, a licence that asks for a credit, another
 * dialect, the fusha), a passage written over one a person passed, and a run
 * that grinds on with nowhere to file what it finds. The search itself is
 * `src/test/wordStoryLine.test.ts`; this is the run around it.
 */

const SERVICE_KEY = "service-role-key-for-a-test";

let backend: SupabaseBackend;
let restore: () => void;
let lines: string[];
let clientCount = 0;

const ctx = (over: Partial<StoryRunContext> = {}): StoryRunContext => ({
  supabaseUrl: SUPABASE_URL,
  serviceRoleKey: SERVICE_KEY,
  fetch: (url, init) => globalThis.fetch(url, init),
  client: createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { storageKey: `sb-curriculum-stories-${++clientCount}` },
  }) as unknown as StoryClient & WordAssetClient & AssetRowDeleter,
  log: (line) => lines.push(line),
  leaksFor: async (dialect) => (text) => detectMsaLeaks(text, dialect).leaks,
  ...over,
});

const options = (over: Partial<StoryOptions> = {}): StoryOptions => ({
  dialect: null,
  stage: null,
  limit: null,
  dryRun: false,
  ...over,
});

const morning = { arabic: "كان الصبح بارد وايد.", english: "The morning was very cold." };
const ordered = { arabic: "طلب الريال قهوة حارة.", english: "The man ordered hot coffee." };
const bread = { arabic: "وبعدين اشترى خبز.", english: "And then he bought bread." };

/** A story as the import writes it: fusha on each line, the rendering beside it, the body rebuilt from the renderings. */
function story(index: number, over: Record<string, unknown>, renderings: Array<{ arabic: string; english: string }>) {
  const id = storyId(index);
  return {
    story: anAuthenticStory({
      id,
      title: `Story ${index}`,
      body_fusha: renderings.map((_, i) => `سطر فصيح ${i}`).join("\n"),
      body_dialect: renderings.map((r) => r.arabic).join("\n"),
      ...over,
    }),
    lines: renderings.map((r, i) =>
      anAuthenticStoryLine({ id: storyLineId(index * 100 + i), story_id: id, line_index: i, arabic: `سطر فصيح ${i}`, dialect: r.arabic, english: r.english }),
    ),
  };
}

/** Stage one: Gulf قهوة and خبز, Egyptian قهوة. Stage two: Gulf شاي. */
function seed({
  stories = [story(0, {}, [morning, ordered, bread])],
  wordAssets = [],
}: { stories?: Array<ReturnType<typeof story>>; wordAssets?: Array<Record<string, unknown>> } = {}) {
  backend.db.seedAll({
    curriculum_stages: [aStage({ id: stageId(0), stage_number: 1 }), aStage({ id: stageId(1), stage_number: 2 })],
    lessons: [
      aLesson({ id: lessonId(0), stage_id: stageId(0), dialect_module: "Gulf" }),
      aLesson({ id: lessonId(1), stage_id: stageId(0), dialect_module: "Egyptian" }),
      aLesson({ id: lessonId(2), stage_id: stageId(1), dialect_module: "Gulf" }),
    ],
    vocabulary_words: [
      aVocabularyWord({ id: wordId(0), lesson_id: lessonId(0), word_arabic: "قهوة", word_english: "coffee", display_order: 1 }),
      aVocabularyWord({ id: wordId(1), lesson_id: lessonId(0), word_arabic: "خبز", word_english: "bread", display_order: 2 }),
      aVocabularyWord({ id: wordId(2), lesson_id: lessonId(1), dialect_module: "Egyptian", word_arabic: "قهوة", word_english: "coffee", display_order: 1 }),
      aVocabularyWord({ id: wordId(3), lesson_id: lessonId(2), word_arabic: "شاي", word_english: "tea", display_order: 1 }),
    ],
    authentic_stories: stories.map((s) => s.story),
    authentic_story_lines: stories.flatMap((s) => s.lines),
    word_assets: wordAssets,
  });
}

const passages = () => backend.db.raw("word_assets").filter((row) => row.kind === "story_line");

const writtenPassage = (over: Record<string, unknown> = {}) => ({
  id: "asset-coffee-story",
  concept_key: "قهوه|coffee",
  kind: "story_line",
  dialect: "Gulf",
  style_version: "text-1",
  url: null,
  payload: { sentences: [{ arabic: "رحنا السوق.", english: "We went." }, { arabic: "شربنا قهوة.", english: "We drank coffee." }] },
  meta: {},
  source: "generated",
  approved_at: null,
  created_at: "2026-10-01T00:00:00Z",
  ...over,
});

beforeEach(() => {
  const installed = installSupabaseFetch();
  backend = installed.backend;
  restore = installed.restore;
  lines = [];
});

afterEach(() => restore());

describe("a dry run", () => {
  it("lists what the library would lend each word, and writes nothing", async () => {
    seed();
    const summary = await runStories(ctx(), options({ dryRun: true }));

    expect(backend.db.writes).toEqual([]);
    expect(summary).toMatchObject({ dryRun: true, words: 4, keys: 4, taken: 2, none: 2, have: 0, failed: 0 });
    expect(lines.some((line) => line.startsWith("would take: قهوة (Gulf) ← “Story 0”, line 1–2"))).toBe(true);
    expect(lines.some((line) => line.includes("خبز (Gulf)"))).toBe(true);
    const printed = formatStorySummary(summary).join("\n");
    expect(printed).toContain("would take from a published story: 2");
    expect(printed).toContain("Cost: none. No model is called and nobody is charged.");
  });

  it("says what the shelf holds, and why each story left out is", async () => {
    seed({
      stories: [
        story(0, {}, [morning, ordered]),
        story(1, { status: "draft" }, [morning, ordered]),
        story(2, { license: "CC-BY" }, [morning, ordered]),
        story(3, { dialect: "Levantine" }, [morning, ordered]),
        story(4, { dialect: "MSA" }, [morning, ordered]),
        story(5, { dialect: "Egyptian", license: "CC0" }, [morning, ordered]),
      ],
    });
    await runStories(ctx(), options({ dryRun: true }));
    const shelf = lines.slice(0, 4).join("\n");
    expect(shelf).toContain("6 stories, 2 of which may lend a passage (Gulf 1, Egyptian 1, Yemeni 0)");
    expect(shelf).toContain("not published: 1");
    expect(shelf).toContain("a licence that asks for a credit: 1 CC-BY");
    expect(shelf).toContain("not a dialect the store keys on: 1 Levantine, 1 MSA");
  });

  it("still lists what it would take while the store's table is missing, and says nothing would be kept", async () => {
    seed();
    backend.db.failAlways("word_assets", 404, {
      code: "PGRST205",
      message: "Could not find the table 'public.word_assets' in the schema cache",
    });
    const summary = await runStories(ctx(), options({ dryRun: true }));
    expect(summary.storeMissing).toBe(true);
    expect(summary.taken).toBe(2);
    expect(formatStorySummary(summary).join("\n")).toContain(STORE_MISSING);
  });
});

describe("a real run", () => {
  it("files each word's passage from a published story, from its dialect text, as reviewed", async () => {
    seed();
    const summary = await runStories(ctx(), options());

    expect(summary).toMatchObject({ taken: 2, none: 2, failed: 0 });
    expect(storyRunFailed(summary)).toBe(false);
    const coffee = passages().find((row) => row.concept_key === "قهوه|coffee")!;
    expect(coffee).toMatchObject({ kind: "story_line", dialect: "Gulf", style_version: "text-1", source: "reviewed", url: null });
    expect((coffee.payload as { sentences: unknown }).sentences).toEqual([morning, ordered]);
    expect(JSON.stringify(coffee.payload)).not.toContain("فصيح");
    expect(coffee.meta).toMatchObject({ from: "story", story_id: storyId(0), line_indexes: [0, 1], license: "public_domain" });
    const breadRow = passages().find((row) => row.concept_key === "خبز|bread")!;
    expect((breadRow.payload as { sentences: unknown }).sentences).toEqual([ordered, bread]);
    // Nothing for the Egyptian coffee (no Egyptian story) or for tea.
    expect(passages()).toHaveLength(2);
    // Nothing onto the curriculum rows.
    expect(backend.db.writes.every((write) => write.table === "word_assets")).toBe(true);
  });

  it("is a no-op the second time", async () => {
    seed();
    await runStories(ctx(), options());
    const before = backend.db.writes.length;
    lines = [];
    const again = await runStories(ctx(), options());
    expect(again).toMatchObject({ have: 2, taken: 0 });
    expect(backend.db.writes.length).toBe(before);
  });

  it("takes the place of a passage a learner's miss wrote, and of nothing a person passed", async () => {
    seed({ wordAssets: [writtenPassage()] });
    const summary = await runStories(ctx(), options({ dialect: "Gulf", stage: 1 }));
    expect(summary).toMatchObject({ taken: 2, replacing: 1 });
    const coffee = passages().find((row) => row.concept_key === "قهوه|coffee")!;
    expect(coffee.source).toBe("reviewed");
    expect((coffee.meta as { replaces?: unknown }).replaces).toEqual(writtenPassage().payload);

    for (const kept of [{ source: "authored" }, { source: "reviewed" }, { approved_at: "2026-10-05T00:00:00Z" }]) {
      restore();
      const installed = installSupabaseFetch();
      backend = installed.backend;
      restore = installed.restore;
      seed({ wordAssets: [writtenPassage(kept)] });
      const run = await runStories(ctx(), options({ dialect: "Gulf", stage: 1 }));
      expect(run.have, JSON.stringify(kept)).toBe(1);
      expect(passages().find((row) => row.concept_key === "قهوه|coffee")?.payload, JSON.stringify(kept)).toEqual(
        writtenPassage().payload,
      );
    }
  });

  describe("taking back what a story no longer lends", () => {
    /** What a run filed from story 0 for the Gulf coffee. */
    const lent = (over: Record<string, unknown> = {}) => ({
      ...writtenPassage(),
      source: "reviewed",
      payload: { sentences: [morning, ordered], story: { id: storyId(0), title: "Story 0", titleArabic: "" } },
      meta: { from: "story", story_id: storyId(0), story_title: "Story 0", line_indexes: [0, 1], license: "public_domain" },
      ...over,
    });

    it("keeps a passage its story still lends", async () => {
      seed({ wordAssets: [lent()] });
      const summary = await runStories(ctx(), options({ dialect: "Gulf", stage: 1 }));
      expect(summary).toMatchObject({ have: 1, revoked: 0 });
      expect(passages().find((row) => row.concept_key === "قهوه|coffee")?.id).toBe("asset-coffee-story");
    });

    it("takes back a passage whose story was re-licensed, and looks again", async () => {
      seed({
        stories: [story(0, { license: "CC-BY" }, [morning, ordered]), story(1, {}, [{ arabic: "شرب قهوة.", english: "He drank coffee." }, bread])],
        wordAssets: [lent()],
      });
      const summary = await runStories(ctx(), options({ dialect: "Gulf", stage: 1 }));
      expect(summary.revoked).toBe(1);
      const coffee = passages().find((row) => row.concept_key === "قهوه|coffee")!;
      // Gone from story 0, filed afresh from story 1.
      expect(coffee.id).not.toBe("asset-coffee-story");
      expect((coffee.meta as { story_id: string }).story_id).toBe(storyId(1));
      expect(lines.some((line) => line.startsWith("took back: قهوة (Gulf), “Story 0”"))).toBe(true);
    });

    it("takes back a passage whose story was unpublished or deleted, and leaves the word for its next learner", async () => {
      for (const stories of [[story(0, { status: "draft" }, [morning, ordered])], []]) {
        restore();
        const installed = installSupabaseFetch();
        backend = installed.backend;
        restore = installed.restore;
        seed({ stories, wordAssets: [lent()] });
        const summary = await runStories(ctx(), options({ dialect: "Gulf", stage: 1 }));
        expect(summary.revoked).toBe(1);
        expect(passages().find((row) => row.concept_key === "قهوه|coffee")).toBeUndefined();
      }
    });

    it("only lists what it would take back in a dry run", async () => {
      seed({ stories: [story(0, { status: "draft" }, [morning, ordered])], wordAssets: [lent()] });
      const summary = await runStories(ctx(), options({ dryRun: true }));
      expect(summary.revoked).toBe(1);
      expect(backend.db.writes).toEqual([]);
      expect(formatStorySummary(summary).join("\n")).toContain("would take back, their story no longer lending them: 1");
    });

    it("never takes back a passage written for the word", async () => {
      seed({ stories: [], wordAssets: [writtenPassage({ source: "authored" })] });
      const summary = await runStories(ctx(), options({ dialect: "Gulf", stage: 1 }));
      expect(summary.revoked).toBe(0);
      expect(passages()).toHaveLength(1);
    });
  });

  it("files at most --limit passages, and leaves the rest for a later run", async () => {
    seed();
    const summary = await runStories(ctx(), options({ limit: 1 }));
    expect(summary).toMatchObject({ taken: 1, leftForLater: 1 });
    expect(passages()).toHaveLength(1);
  });

  it("files nothing and stops before searching when the store's table is missing", async () => {
    seed();
    backend.db.failAlways("word_assets", 404, {
      code: "PGRST205",
      message: "Could not find the table 'public.word_assets' in the schema cache",
    });
    const summary = await runStories(ctx(), options());
    expect(summary.stopped).toBe(STORE_MISSING);
    expect(storyRunFailed(summary)).toBe(true);
    expect(backend.db.readsOf("authentic_story_lines")).toEqual([]);
  });

  it("stops after failures in a row", async () => {
    seed({
      stories: [story(0, {}, [morning, ordered, bread, { arabic: "وشرب شاي.", english: "And he drank tea." }])],
    });
    backend.db.failWrites("word_assets", 500, { code: "XX000", message: "down" });
    const summary = await runStories(ctx(), options());
    expect(summary.failed).toBe(MAX_CONSECUTIVE_FAILURES);
    expect(summary.stopped).toContain("could not be filed");
  });

  it("leaves out a story passage the leak detector finds MSA in", async () => {
    const leaking = { arabic: "لماذا طلب الريال قهوة؟", english: "Why did the man order coffee?" };
    seed({ stories: [story(0, {}, [morning, leaking])] });
    const summary = await runStories(ctx(), options({ dialect: "Gulf", stage: 1 }));
    expect(passages()).toEqual([]);
    expect(summary.none).toBe(2);
  });
});

describe("planning", () => {
  it("files one passage per word, sense and dialect, however many rows share it", () => {
    const row = (id: string, word: string, english: string, dialect: string) => ({
      id,
      word_arabic: word,
      word_english: english,
      category: null,
      dialect_module: dialect,
      lesson_id: null,
      display_order: null,
    });
    const { plans, unkeyed } = planStoryWords([
      row("a", "قهوة", "coffee", "Gulf"),
      row("b", "قَهْوَة", "Coffee", "Gulf"),
      row("c", "قهوة", "coffee", "Egyptian"),
      row("d", "coffee", "coffee", "Gulf"),
    ]);
    expect(plans.map((plan) => [plan.key.dialect, plan.key.conceptKey, plan.words.length])).toEqual([
      ["Gulf", "قهوه|coffee", 2],
      ["Egyptian", "قهوه|coffee", 1],
    ]);
    expect(unkeyed).toBe(1);
  });

  it("describes an empty shelf", () => {
    expect(describeShelf([])).toEqual({
      stories: 0,
      lending: { Gulf: 0, Egyptian: 0, Yemeni: 0 },
      unpublished: 0,
      licence: {},
      otherDialect: {},
    });
  });
});
