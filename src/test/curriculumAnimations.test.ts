import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSupabaseFetch } from "./support/transports/vitest";
import { SUPABASE_URL, type SupabaseBackend } from "./support/server/handler";
import { aLesson, aStage, aVocabularyWord, lessonId, stageId, wordId } from "./support/factories";
import {
  animationRunFailed,
  clipCostUsd,
  formatAnimationSummary,
  MAX_CONSECUTIVE_FAILURES,
  PENDING_POLL_MS,
  planActions,
  runAnimations,
  type AnimationOptions,
  type AnimationWordRow,
} from "../../scripts/curriculum-animations-core.ts";
import type { RunContext } from "../../scripts/curriculum-pictures-core.ts";

/**
 * `scripts/curriculum-animations.ts`, the tool that makes a clip for every
 * action in the curriculum (quiz Phase 5), driven against the in-memory
 * project.
 *
 * A real run spends a poster and four seconds of Veo per clip on the live
 * project's keys, so the tests are about what must not go wrong there: a dry
 * run that makes anything, or that cannot say what a run would cost; a clip
 * made once per word rather than once per action; a slow render asked for a
 * second time and paid for twice; a run that grinds on after the first
 * answer said every clip would fail. `word-asset` itself is stubbed: its
 * behaviour is `supabase/functions/_test/word_asset_test.ts`.
 */

const SERVICE_KEY = "service-role-key-for-a-test";

let backend: SupabaseBackend;
let restore: () => void;
let lines: string[];
let pauses: number[];
let bucketMissing: boolean;

const ctx = (): RunContext => ({
  supabaseUrl: SUPABASE_URL,
  serviceRoleKey: SERVICE_KEY,
  fetch: (url, init) =>
    bucketMissing && url.includes("/storage/v1/bucket/word-animations")
      ? Promise.resolve(new Response(JSON.stringify({ error: "Bucket not found" }), { status: 404 }))
      : globalThis.fetch(url, init),
  sleep: async (ms) => {
    pauses.push(ms);
  },
  log: (line) => lines.push(line),
});

const options = (over: Partial<AnimationOptions> = {}): AnimationOptions => ({
  dialect: null,
  stage: null,
  limit: null,
  dryRun: false,
  ...over,
});

/** What `word-asset` answers when it makes a clip and files it. */
const made = (gloss: string) => ({
  asset: { id: "a", url: `https://cdn.test/${gloss}.mp4` },
  url: `https://cdn.test/${encodeURIComponent(gloss)}.mp4`,
  cached: false,
  stored: true,
});

/** A filed clip of an action. */
const storedClip = (action: string) => ({
  id: `asset-${action}`,
  concept_key: action,
  kind: "animation",
  dialect: null,
  style_version: "ink-1",
  url: `https://cdn.test/stored-${action}.mp4`,
  payload: { poster: `https://cdn.test/stored-${action}.png`, seconds: 4, aspect: "16:9" },
  meta: {},
  source: "generated",
  approved_at: null,
  created_at: "2026-10-09T00:00:00Z",
});

/**
 * Stage one: Gulf "I eat", Egyptian "I eat" (one action), a Gulf "I want"
 * (a verb with nothing to watch), a Gulf noun. Stage two: Gulf "I drink",
 * Yemeni "laughed", and an adverb that only contains the letters.
 */
function seedCurriculum(wordAssets: unknown[] = []) {
  backend.db.seedAll({
    curriculum_stages: [aStage({ id: stageId(0), stage_number: 1 }), aStage({ id: stageId(1), stage_number: 2 })],
    lessons: [
      aLesson({ id: lessonId(0), stage_id: stageId(0), dialect_module: "Gulf" }),
      aLesson({ id: lessonId(1), stage_id: stageId(0), dialect_module: "Egyptian" }),
      aLesson({ id: lessonId(2), stage_id: stageId(1), dialect_module: "Gulf" }),
      aLesson({ id: lessonId(3), stage_id: stageId(1), dialect_module: "Yemeni" }),
    ],
    vocabulary_words: [
      aVocabularyWord({ id: wordId(0), lesson_id: lessonId(0), word_arabic: "آكل", word_english: "I eat", category: "Verb — routine", display_order: 1 }),
      aVocabularyWord({ id: wordId(1), lesson_id: lessonId(0), word_arabic: "أبي", word_english: "I want", category: "Verb", display_order: 2 }),
      aVocabularyWord({ id: wordId(2), lesson_id: lessonId(0), word_arabic: "قهوة", word_english: "coffee", category: "Food & drink", display_order: 3 }),
      aVocabularyWord({ id: wordId(3), lesson_id: lessonId(1), dialect_module: "Egyptian", word_arabic: "باكل", word_english: "I eat", category: "Verb — routine", display_order: 1 }),
      aVocabularyWord({ id: wordId(4), lesson_id: lessonId(2), word_arabic: "أشرب", word_english: "I drink", category: "Verb — routine", display_order: 1 }),
      aVocabularyWord({ id: wordId(5), lesson_id: lessonId(3), dialect_module: "Yemeni", word_arabic: "ضحك", word_english: "laughed", category: "Verb", display_order: 1 }),
      aVocabularyWord({ id: wordId(6), lesson_id: lessonId(3), dialect_module: "Yemeni", word_arabic: "فجأة", word_english: "suddenly", category: "Adverb", display_order: 2 }),
    ],
    word_assets: wordAssets,
  });
}

const asked = () => backend.callsTo("word-asset").map((call) => call.body as Record<string, unknown>);

beforeEach(() => {
  const installed = installSupabaseFetch();
  backend = installed.backend;
  restore = installed.restore;
  lines = [];
  pauses = [];
  bucketMissing = false;
  seedCurriculum();
  backend.stubFunction("word-asset", ({ body }) => made(String((body as { gloss: string }).gloss)));
});

afterEach(() => restore());

describe("which actions get a clip", () => {
  const row = (over: Partial<AnimationWordRow>): AnimationWordRow => ({
    id: "w",
    word_arabic: "آكل",
    word_english: "I eat",
    category: "Verb — routine",
    dialect_module: "Gulf",
    lesson_id: null,
    display_order: 1,
    ...over,
  });

  it("plans one clip per action, however many words and dialects share it", () => {
    const { actions, notActions } = planActions([
      row({ id: "a" }),
      row({ id: "b", word_arabic: "باكل", dialect_module: "Egyptian" }),
      row({ id: "c", word_english: "eat", category: "Verb" }),
      row({ id: "d", word_english: "I want", category: "Verb" }),
      row({ id: "e", word_english: "suddenly", category: "Adverb" }),
    ]);
    expect(actions.map((a) => a.key.conceptKey)).toEqual(["eat"]);
    expect(actions[0].words.map((w) => w.id)).toEqual(["a", "b", "c"]);
    expect(notActions).toBe(2);
  });
});

describe("a dry run", () => {
  it("makes nothing, writes nothing, and prints the clips and what they cost", async () => {
    const summary = await runAnimations(ctx(), options({ dryRun: true }));

    expect(backend.callsTo("word-asset")).toEqual([]);
    expect(summary).toMatchObject({ words: 7, notActions: 3, actions: 3, have: 0, made: 3, stopped: null });

    const text = formatAnimationSummary(summary).join("\n");
    const cost = clipCostUsd();
    expect(text).toContain(`3 clips to make: 3 × $${cost.vendor.toFixed(2)}`);
    expect(text).toContain(`= $${(3 * cost.vendor).toFixed(2)}`);
    expect(text).toContain("Nothing was made or written.");
  });

  it("prices a clip as a poster and four seconds of Veo 3.1 Lite", () => {
    const cost = clipCostUsd();
    expect(cost.vendor).toBeCloseTo(0.067 + 4 * 0.05, 5);
    expect(cost.openrouter).toBeCloseTo(0.067 + 4 * 0.03, 5);
  });

  it("does not count or bill an action already in the store", async () => {
    restore();
    const installed = installSupabaseFetch();
    backend = installed.backend;
    restore = installed.restore;
    seedCurriculum([storedClip("eat")]);

    const summary = await runAnimations(ctx(), options({ dryRun: true }));
    expect(summary).toMatchObject({ actions: 3, have: 1, made: 2 });
  });

  it("still prices every action when the store's table is not on the project, and says a real run would stop", async () => {
    backend.db.failAlways("word_assets", 404, {
      code: "PGRST205",
      message: "Could not find the table 'public.word_assets' in the schema cache",
    });
    const summary = await runAnimations(ctx(), options({ dryRun: true }));

    expect(summary.made).toBe(3);
    expect(summary.stopped).toMatch(/word_assets is not on this project/);
    expect(formatAnimationSummary(summary).join("\n")).toMatch(/A real run would stop/);
  });

  it("says so when the bucket is not on the project", async () => {
    bucketMissing = true;
    const summary = await runAnimations(ctx(), options({ dryRun: true }));
    expect(summary.made).toBe(3);
    expect(summary.stopped).toMatch(/word-animations bucket/);
  });

  it("keeps to the filters", async () => {
    const stageTwoGulf = await runAnimations(ctx(), options({ dryRun: true, stage: 2, dialect: "Gulf" }));
    expect(stageTwoGulf).toMatchObject({ words: 1, actions: 1, made: 1 });
    expect(lines.some((line) => line.includes('"drink"'))).toBe(true);
  });
});

describe("a real run", () => {
  it("asks once per action, on the trusted path, and writes nothing to the curriculum", async () => {
    const before = JSON.stringify(backend.db.raw("vocabulary_words"));
    const summary = await runAnimations(ctx(), options());

    expect(asked().map((body) => [body.action, body.kind, body.gloss])).toEqual([
      ["ensure", "animation", "I eat"],
      ["ensure", "animation", "I drink"],
      ["ensure", "animation", "laughed"],
    ]);
    const [call] = backend.callsTo("word-asset");
    expect(call.headers.authorization).toBe(`Bearer ${SERVICE_KEY}`);
    expect(summary).toMatchObject({ made: 3, have: 0, failed: [], stopped: null });
    expect(JSON.stringify(backend.db.raw("vocabulary_words"))).toBe(before);
    expect(animationRunFailed(summary)).toBe(false);
  });

  it("counts --limit in clips paid for, not in words, and not the ones the store has", async () => {
    restore();
    const installed = installSupabaseFetch();
    backend = installed.backend;
    restore = installed.restore;
    seedCurriculum([storedClip("eat")]);
    backend.stubFunction("word-asset", ({ body }) => made(String((body as { gloss: string }).gloss)));

    const summary = await runAnimations(ctx(), options({ limit: 1 }));
    expect(asked().map((body) => body.gloss)).toEqual(["I drink"]);
    expect(summary).toMatchObject({ have: 1, made: 1, beyondLimit: 1 });
  });

  it("waits out a slow render with free lookups, never a second ensure", async () => {
    let gets = 0;
    backend.stubFunction("word-asset", ({ body }) => {
      const b = body as { action: string; gloss: string };
      if (b.action === "ensure") return { pending: true };
      // Filed on the second look.
      return ++gets < 2 ? { asset: null, url: null, cached: false, stored: false } : made(b.gloss);
    });

    const summary = await runAnimations(ctx(), options({ limit: 1 }));

    expect(asked().map((body) => body.action)).toEqual(["ensure", "get", "get"]);
    expect(pauses.filter((ms) => ms === PENDING_POLL_MS)).toHaveLength(2);
    expect(summary).toMatchObject({ made: 1, failed: [] });
  });

  it("stops at once when the store's table is missing, before anything is asked", async () => {
    backend.db.failAlways("word_assets", 404, {
      code: "PGRST205",
      message: "Could not find the table 'public.word_assets' in the schema cache",
    });
    const summary = await runAnimations(ctx(), options());
    expect(backend.callsTo("word-asset")).toEqual([]);
    expect(summary.stopped).toMatch(/Phase 2b/);
    expect(animationRunFailed(summary)).toBe(true);
  });

  it("stops at once when the bucket is missing, before anything is asked", async () => {
    bucketMissing = true;
    const summary = await runAnimations(ctx(), options());
    expect(backend.callsTo("word-asset")).toEqual([]);
    expect(summary.stopped).toMatch(/20261009140000_word_animations_bucket/);
  });

  it("stops on the first answer that says every clip would fail", async () => {
    for (const [status, body, says] of [
      [401, { error: "auth_required" }, /refused the key/],
      [403, { error: "animation_not_for_learners" }, /refused the key/],
      [404, { message: "Function not found" }, /not deployed/],
      [400, { error: "kind_not_generated" }, /deploy the Phase 5 function/],
      [503, { error: "bucket_not_ready" }, /bucket/],
      [503, { error: "ai_unconfigured" }, /no provider/],
    ] as const) {
      backend.stubFunctionFailure("word-asset", status, body);
      const before = backend.callsTo("word-asset").length;
      const summary = await runAnimations(ctx(), options());
      expect(backend.callsTo("word-asset").length - before, String(status)).toBe(1);
      expect(summary.stopped, `${status} ${JSON.stringify(body)}`).toMatch(says);
    }
  });

  it("skips an action word-asset turns away, and goes on", async () => {
    backend.stubFunction("word-asset", ({ body }) => {
      const gloss = String((body as { gloss: string }).gloss);
      return gloss === "I eat" ? { status: 400, body: { error: "not_an_action" } } : made(gloss);
    });
    const summary = await runAnimations(ctx(), options());
    expect(summary.made).toBe(2);
    expect(summary.skipped).toHaveLength(1);
  });

  it("gives up after a few clips fail in a row", async () => {
    backend.stubFunction("word-asset", () => ({ error: "ANIMATION_GENERATION_FAILED", fallback: true, message: "nope" }));
    const summary = await runAnimations(ctx(), options());
    expect(summary.failed).toHaveLength(MAX_CONSECUTIVE_FAILURES);
    expect(summary.stopped).toMatch(/failed in a row/);
  });
});
