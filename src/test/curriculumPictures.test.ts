import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installSupabaseFetch } from "./support/transports/vitest";
import { SUPABASE_URL, type SupabaseBackend } from "./support/server/handler";
import { aLesson, aStage, aVocabularyWord, lessonId, stageId, wordId } from "./support/factories";
import {
  ensurePicture,
  formatSummary,
  listWordsWithoutPicture,
  MAX_CONSECUTIVE_FAILURES,
  parseArgs,
  planWord,
  projectFromEnv,
  runFailed,
  runPictures,
  STORE_MISSING_WARNING,
  supabaseUrlFromConfig,
  type PictureOptions,
  type RunContext,
  type WordRow,
} from "../../scripts/curriculum-pictures-core.ts";

/**
 * `scripts/curriculum-pictures.ts`, the tool that gives every curriculum word
 * its picture (quiz Phase 3), driven against the in-memory project.
 *
 * The real run costs an image generation per word on the live project's keys
 * and writes onto the curriculum every learner is served, so the tests are
 * about what must not go wrong there: a dry run that draws or writes, a
 * mistyped flag that becomes a full run, a picture written over one an admin
 * just added, a run that grinds through eight hundred words after the first
 * answer already said they would all fail, and a curriculum left without
 * pictures because the store's table has not reached the live project.
 *
 * The emulator parses every query the script sends as PostgREST would and
 * rejects an unknown column, so the raw REST urls the script builds are
 * checked here, not only the logic around them. `word-asset` itself is
 * stubbed: its own behaviour is `supabase/functions/_test/word_asset_test.ts`.
 */

const SERVICE_KEY = "service-role-key-for-a-test";
const STAGE_ONE = stageId(0);
const STAGE_TWO = stageId(1);
const DALLAH = "a brass dallah pouring into a small finjan";

let backend: SupabaseBackend;
let restore: () => void;
let lines: string[];
let pauses: number[];

const ctx = (): RunContext => ({
  supabaseUrl: SUPABASE_URL,
  serviceRoleKey: SERVICE_KEY,
  fetch: (url, init) => globalThis.fetch(url, init),
  sleep: async (ms) => {
    pauses.push(ms);
  },
  log: (line) => lines.push(line),
});

const options = (over: Partial<PictureOptions> = {}): PictureOptions => ({
  dialect: null,
  stage: null,
  limit: null,
  dryRun: false,
  ...over,
});

/** What `word-asset` answers when it draws a picture and files it. */
const drawn = (url: string, over: Record<string, unknown> = {}) => ({
  asset: { id: "a", url, source: "authored" },
  url,
  cached: false,
  stored: true,
  authored: true,
  ...over,
});

/** A `word_assets` row for a Gulf word's picture. */
const stored = (conceptKey: string, over: Record<string, unknown> = {}) => ({
  id: `asset-${conceptKey}`,
  concept_key: conceptKey,
  kind: "image",
  dialect: "Gulf",
  style_version: "ink-1",
  url: `https://cdn.test/${encodeURIComponent(conceptKey)}.png`,
  payload: null,
  meta: {},
  source: "generated",
  approved_at: null,
  created_at: "2026-10-09T00:00:00Z",
  ...over,
});

/**
 * Two stages. Stage one has a Gulf and an Egyptian lesson; stage two a Gulf
 * one. Coffee and tea have no picture; bread has one already.
 */
function seedCurriculum() {
  backend.db.seedAll({
    curriculum_stages: [aStage({ id: STAGE_ONE, stage_number: 1 }), aStage({ id: STAGE_TWO, stage_number: 2 })],
    lessons: [
      aLesson({ id: lessonId(0), stage_id: STAGE_ONE, dialect_module: "Gulf" }),
      aLesson({ id: lessonId(1), stage_id: STAGE_ONE, dialect_module: "Egyptian" }),
      aLesson({ id: lessonId(2), stage_id: STAGE_TWO, dialect_module: "Gulf" }),
    ],
    vocabulary_words: [
      aVocabularyWord({
        id: wordId(0),
        lesson_id: lessonId(0),
        word_arabic: "قَهْوَة",
        word_english: "coffee",
        image_scene_description: DALLAH,
        display_order: 1,
      }),
      aVocabularyWord({
        id: wordId(1),
        lesson_id: lessonId(0),
        word_arabic: "شاي",
        word_english: "tea",
        image_scene_description: "a glass of red tea with mint",
        display_order: 2,
      }),
      aVocabularyWord({
        id: wordId(2),
        lesson_id: lessonId(0),
        word_arabic: "خبز",
        word_english: "bread",
        image_url: "https://cdn.test/bread-already.png",
        display_order: 3,
      }),
      aVocabularyWord({
        id: wordId(3),
        lesson_id: lessonId(1),
        dialect_module: "Egyptian",
        word_arabic: "عيش",
        word_english: "bread",
        image_scene_description: "a round of baladi bread",
        display_order: 1,
      }),
      aVocabularyWord({
        id: wordId(4),
        lesson_id: lessonId(2),
        word_arabic: "سوق",
        word_english: "market",
        // The admin form clears a picture to an empty string, not to null.
        image_url: "",
        image_scene_description: null,
        display_order: 1,
      }),
    ],
    word_assets: [],
  });
}

const imageOf = (id: string) => backend.db.raw("vocabulary_words").find((row) => row.id === id)?.image_url;
const asked = () => backend.callsTo("word-asset").map((call) => call.body as Record<string, unknown>);

beforeEach(() => {
  const installed = installSupabaseFetch();
  backend = installed.backend;
  restore = installed.restore;
  lines = [];
  pauses = [];
  seedCurriculum();
  // Each word gets a picture of its own, drawn from what was sent.
  backend.stubFunction("word-asset", ({ body }) =>
    drawn(`https://cdn.test/drawn/${encodeURIComponent(String((body as { gloss: string }).gloss))}.png`),
  );
});

afterEach(() => restore());

describe("the flags", () => {
  it("reads the four of them, in either form", () => {
    expect(parseArgs(["--dialect", "Egyptian", "--stage", "2", "--limit", "20", "--dry-run"])).toEqual({
      options: { dialect: "Egyptian", stage: 2, limit: 20, dryRun: true },
    });
    expect(parseArgs(["--dialect=gulf", "--stage=1", "--limit=5"])).toEqual({
      options: { dialect: "Gulf", stage: 1, limit: 5, dryRun: false },
    });
    expect(parseArgs([])).toEqual({ options: { dialect: null, stage: null, limit: null, dryRun: false } });
  });

  it("refuses a flag it does not know rather than running without it", () => {
    // `--dryrun` read as nothing would be a real run that draws every word.
    for (const typo of ["--dryrun", "--dry_run", "-n", "--limt", "dry-run"]) {
      expect(parseArgs([typo])).toEqual({ error: `unknown argument: ${typo}` });
    }
    expect(parseArgs(["--dry-run=false"])).toEqual({ error: "--dry-run takes no value" });
  });

  it("refuses a value that is not one", () => {
    expect(parseArgs(["--dialect", "MSA"])).toHaveProperty("error");
    expect(parseArgs(["--dialect"])).toHaveProperty("error");
    expect(parseArgs(["--stage", "one"])).toHaveProperty("error");
    // A limit that silently became "no limit" would draw everything.
    for (const limit of ["0", "-5", "1.5", "5x", ""]) {
      expect(parseArgs(["--limit", limit]), limit).toHaveProperty("error");
    }
    // The next flag is not this one's value.
    expect(parseArgs(["--limit", "--dry-run"])).toHaveProperty("error");
  });

  it("prints the usage when asked", () => {
    expect(parseArgs(["--limit", "3", "--help"])).toEqual({ help: true });
  });
});

describe("where it runs", () => {
  const config = 'project_id = "abcdefghij"\n\n[functions.word-asset]\nverify_jwt = true\n';

  it("takes the project from the environment, else from supabase/config.toml", () => {
    expect(supabaseUrlFromConfig(config)).toBe("https://abcdefghij.supabase.co");
    expect(projectFromEnv({ SUPABASE_SERVICE_ROLE_KEY: " k " }, config)).toEqual({
      supabaseUrl: "https://abcdefghij.supabase.co",
      serviceRoleKey: "k",
    });
    expect(projectFromEnv({ SUPABASE_SERVICE_ROLE_KEY: "k", SUPABASE_URL: "https://other.supabase.co/" }, config)).toEqual({
      supabaseUrl: "https://other.supabase.co",
      serviceRoleKey: "k",
    });
  });

  it("says what is missing instead of running against nothing", () => {
    expect(projectFromEnv({}, config)).toEqual({ error: "not configured: missing SUPABASE_SERVICE_ROLE_KEY" });
    expect(projectFromEnv({ SUPABASE_SERVICE_ROLE_KEY: "k" }, null)).toHaveProperty("error");
    // The key travels in a header: never over plain http to anywhere but a
    // local stack.
    expect(projectFromEnv({ SUPABASE_SERVICE_ROLE_KEY: "k", SUPABASE_URL: "http://example.com" }, null)).toHaveProperty(
      "error",
    );
    expect(projectFromEnv({ SUPABASE_SERVICE_ROLE_KEY: "k", SUPABASE_URL: "http://localhost:54321" }, null)).toEqual({
      supabaseUrl: "http://localhost:54321",
      serviceRoleKey: "k",
    });
  });
});

describe("what is asked for a word", () => {
  const row = (over: Partial<WordRow> = {}): WordRow => ({
    id: "w",
    word_arabic: "قَهْوَة",
    word_english: "coffee",
    dialect_module: "Gulf",
    image_scene_description: DALLAH,
    lesson_id: null,
    display_order: 1,
    ...over,
  });

  it("is keyed as a learner's saved word is, so the two share a picture", () => {
    const plan = planWord(row());
    expect(plan.key).toMatchObject({ conceptKey: "قهوه|coffee", kind: "image", dialect: "Gulf", styleVersion: "ink-1" });
    expect(plan).toMatchObject({ scene: DALLAH });
  });

  it("carries the authored scene on one line, or none", () => {
    expect(planWord(row({ image_scene_description: "  a dallah\n\n pouring  " }))).toMatchObject({ scene: "a dallah pouring" });
    expect(planWord(row({ image_scene_description: null }))).toMatchObject({ scene: null });
    expect(planWord(row({ image_scene_description: "   " }))).toMatchObject({ scene: null });
  });

  it("sets aside a word the store cannot file, before anything is spent", () => {
    expect(planWord(row({ dialect_module: "MSA" })).key).toBeNull();
    expect(planWord(row({ word_arabic: "coffee" })).key).toBeNull();
    expect(planWord(row({ word_english: "" })).key).toBeNull();
    // `word-asset` answers 400 to a gloss this long.
    expect(planWord(row({ word_english: "coffee ".repeat(20) }))).toMatchObject({
      key: null,
      reason: expect.stringMatching(/a note, not a sense/),
    });
  });
});

describe("which words are listed", () => {
  it("lists every word with no picture, an empty string included, in a fixed order", async () => {
    const rows = await listWordsWithoutPicture(ctx(), { dialect: null, stage: null });

    // Egyptian before Gulf, then by lesson and the word's place in it. Bread
    // has a picture and is not listed.
    expect(rows.map((r) => r.word_english)).toEqual(["bread", "coffee", "tea", "market"]);
    expect(rows.map((r) => r.id)).not.toContain(wordId(2));
  });

  it("keeps to one dialect", async () => {
    const rows = await listWordsWithoutPicture(ctx(), { dialect: "Egyptian", stage: null });
    expect(rows.map((r) => r.word_arabic)).toEqual(["عيش"]);
  });

  it("keeps to one stage's lessons, and to one dialect within it", async () => {
    const one = await listWordsWithoutPicture(ctx(), { dialect: null, stage: 1 });
    expect(one.map((r) => r.word_english)).toEqual(["bread", "coffee", "tea"]);

    const two = await listWordsWithoutPicture(ctx(), { dialect: null, stage: 2 });
    expect(two.map((r) => r.word_english)).toEqual(["market"]);

    const gulfOne = await listWordsWithoutPicture(ctx(), { dialect: "Gulf", stage: 1 });
    expect(gulfOne.map((r) => r.word_english)).toEqual(["coffee", "tea"]);
  });

  it("lists nothing for a stage that does not exist", async () => {
    expect(await listWordsWithoutPicture(ctx(), { dialect: null, stage: 9 })).toEqual([]);
  });

  it("reads past the first page", async () => {
    backend.db.seed(
      "vocabulary_words",
      Array.from({ length: 620 }, (_, index) =>
        aVocabularyWord({ id: wordId(index), word_arabic: "كلمة", word_english: `word ${index}`, display_order: index }),
      ),
    );
    const rows = await listWordsWithoutPicture(ctx(), { dialect: null, stage: null });
    expect(rows).toHaveLength(620);
    expect(new Set(rows.map((r) => r.id)).size).toBe(620);
  });

  it("fails the run when the curriculum cannot be read", async () => {
    backend.db.failAlways("vocabulary_words", 500, { message: "upstream timeout" });
    await expect(runPictures(ctx(), options())).rejects.toThrow(/could not read vocabulary_words: upstream timeout/);
  });
});

describe("a dry run", () => {
  it("draws nothing and writes nothing", async () => {
    const before = JSON.stringify(backend.db.raw("vocabulary_words"));
    const summary = await runPictures(ctx(), options({ dryRun: true }));

    expect(backend.callsTo("word-asset")).toEqual([]);
    expect(backend.db.writes).toEqual([]);
    expect(JSON.stringify(backend.db.raw("vocabulary_words"))).toBe(before);
    expect(summary).toMatchObject({ dryRun: true, listed: 4, drawn: 4, copied: 0, written: 0 });
    expect(pauses).toEqual([]);
  });

  it("says what each word would cost: drawn, redrawn from its scene, or copied for nothing", async () => {
    backend.db.seed("word_assets", [
      // A learner saved قهوة first: drawn from "coffee" alone. The authored
      // scene would take its place.
      stored("قهوه|coffee"),
      // Authored already (an earlier run): copied.
      stored("شاي|tea", { source: "authored" }),
      // Gloss-only, and the row has no scene to put in its place: copied.
      stored("سوق|market"),
    ]);

    const summary = await runPictures(ctx(), options({ dryRun: true }));

    expect(summary).toMatchObject({ drawn: 1, replaced: 1, copied: 2 });
    expect(lines.find((l) => l.includes("coffee"))).toMatch(/^redraw .*in place of a gloss-only picture; scene: a brass dallah/);
    expect(lines.find((l) => l.includes('"tea"'))).toMatch(/^copy .*already in the store \(authored\)/);
    expect(lines.find((l) => l.includes("market"))).toMatch(/^copy /);
    expect(lines.find((l) => l.includes("عيش"))).toMatch(/^draw .*scene: a round of baladi bread/);
    expect(formatSummary(summary).join("\n")).toMatch(/That is 2 image generations\. Nothing was drawn or written\./);
    expect(backend.callsTo("word-asset")).toEqual([]);
  });

  it("does not hand one dialect's word another dialect's stored picture", async () => {
    // Gulf "bread" is filed; the Egyptian عيش is a different key.
    backend.db.seed("word_assets", [stored("عيش|bread", { dialect: "Gulf", source: "authored" })]);
    const summary = await runPictures(ctx(), options({ dryRun: true, dialect: "Egyptian" }));
    expect(summary).toMatchObject({ drawn: 1, copied: 0 });
  });

  it("warns once that nothing would be kept while the store's table is not there, and still counts", async () => {
    backend.db.failAlways("word_assets", 404, {
      code: "PGRST205",
      message: "Could not find the table 'public.word_assets' in the schema cache",
    });

    const summary = await runPictures(ctx(), options({ dryRun: true }));

    expect(summary).toMatchObject({ storeMissing: true, drawn: 4, copied: 0 });
    expect(lines.filter((l) => l.includes(STORE_MISSING_WARNING))).toHaveLength(1);
    expect(formatSummary(summary).join("\n")).toContain("Phase 2b");
    expect(runFailed(summary)).toBe(false);
  });

  it("honours --limit and says how many are left", async () => {
    const summary = await runPictures(ctx(), options({ dryRun: true, limit: 3 }));
    expect(summary).toMatchObject({ listed: 4, drawn: 3, beyondLimit: 1 });
    expect(formatSummary(summary).join("\n")).toMatch(/1 more left for another run/);
  });
});

describe("a real run", () => {
  it("asks for each word's picture with its authored scene and writes the url onto the row", async () => {
    const summary = await runPictures(ctx(), options({ dialect: "Gulf", stage: 1 }));

    expect(asked()).toEqual([
      { action: "ensure", kind: "image", word: "قَهْوَة", gloss: "coffee", dialect: "Gulf", scene: DALLAH },
      { action: "ensure", kind: "image", word: "شاي", gloss: "tea", dialect: "Gulf", scene: "a glass of red tea with mint" },
    ]);
    expect(imageOf(wordId(0))).toBe("https://cdn.test/drawn/coffee.png");
    expect(imageOf(wordId(1))).toBe("https://cdn.test/drawn/tea.png");
    // Outside the filters, and the word that had a picture: untouched.
    expect(imageOf(wordId(2))).toBe("https://cdn.test/bread-already.png");
    expect(imageOf(wordId(3))).toBeNull();
    expect(imageOf(wordId(4))).toBe("");
    expect(summary).toMatchObject({ listed: 2, drawn: 2, written: 2, unfiled: 0, stopped: null });
    expect(runFailed(summary)).toBe(false);
  });

  it("calls with the service-role key, which is what makes the path trusted", async () => {
    await runPictures(ctx(), options({ limit: 1 }));
    const [call] = backend.callsTo("word-asset");
    expect(call.headers.authorization).toBe(`Bearer ${SERVICE_KEY}`);
  });

  it("sends no scene for a word that has none", async () => {
    await runPictures(ctx(), options({ stage: 2 }));
    expect(asked()).toEqual([{ action: "ensure", kind: "image", word: "سوق", gloss: "market", dialect: "Gulf" }]);
    expect(imageOf(wordId(4))).toBe("https://cdn.test/drawn/market.png");
  });

  it("still writes the url onto the row when the store kept nothing", async () => {
    // Until the migration is on the live project `ensure` answers
    // `stored: false`. The curriculum gets its pictures all the same.
    backend.db.failAlways("word_assets", 404, { code: "PGRST205", message: "Could not find the table 'public.word_assets'" });
    backend.stubFunction("word-asset", () => drawn("https://cdn.test/unfiled.png", { asset: null, stored: false }));

    const summary = await runPictures(ctx(), options({ dialect: "Gulf", stage: 1 }));

    expect(imageOf(wordId(0))).toBe("https://cdn.test/unfiled.png");
    expect(imageOf(wordId(1))).toBe("https://cdn.test/unfiled.png");
    expect(summary).toMatchObject({ storeMissing: true, drawn: 2, unfiled: 2, written: 2 });
    expect(lines.some((l) => l.includes(STORE_MISSING_WARNING))).toBe(true);
    expect(lines.find((l) => l.includes("coffee"))).toMatch(/not kept in the store/);
    expect(runFailed(summary)).toBe(false);
  });

  it("tells a copy from a drawing from a replacement, and only pauses after a generation", async () => {
    const answers: Record<string, unknown> = {
      coffee: drawn("https://cdn.test/replaced.png", { replaced: true }),
      tea: { asset: { id: "t", source: "authored" }, url: "https://cdn.test/stored-tea.png", cached: true, stored: true },
      bread: drawn("https://cdn.test/new-bread.png"),
      market: { asset: { id: "m", source: "generated" }, url: "https://cdn.test/stored-market.png", cached: true, stored: true },
    };
    backend.stubFunction("word-asset", ({ body }) => answers[String((body as { gloss: string }).gloss)]);

    const summary = await runPictures(ctx(), options());

    expect(summary).toMatchObject({ drawn: 1, replaced: 1, copied: 2, written: 4 });
    expect(imageOf(wordId(0))).toBe("https://cdn.test/replaced.png");
    expect(imageOf(wordId(1))).toBe("https://cdn.test/stored-tea.png");
    // Order: bread (drawn), coffee (replaced), tea (copied), market (copied).
    // A pause after each generation; none after a copy, none after the last.
    expect(pauses).toHaveLength(2);
  });

  it("leaves a row alone that was given a picture while the script ran", async () => {
    // An admin uploads coffee's picture between the listing and the write.
    backend.stubFunction("word-asset", ({ db, body }) => {
      const gloss = String((body as { gloss: string }).gloss);
      if (gloss === "coffee") {
        const row = db.raw("vocabulary_words").find((r) => r.id === wordId(0));
        if (row) row.image_url = "https://cdn.test/admin-upload.png";
      }
      return drawn(`https://cdn.test/drawn/${gloss}.png`);
    });

    const summary = await runPictures(ctx(), options({ dialect: "Gulf", stage: 1 }));

    expect(imageOf(wordId(0))).toBe("https://cdn.test/admin-upload.png");
    expect(imageOf(wordId(1))).toBe("https://cdn.test/drawn/tea.png");
    expect(summary).toMatchObject({ written: 1, alreadyFilled: 1 });
  });

  it("honours --limit", async () => {
    const summary = await runPictures(ctx(), options({ limit: 1 }));
    expect(backend.callsTo("word-asset")).toHaveLength(1);
    expect(summary).toMatchObject({ written: 1, beyondLimit: 3 });
  });

  it("does not ask for a word the store cannot file, and does not let it use up the limit", async () => {
    backend.db.add(
      "vocabulary_words",
      aVocabularyWord({ id: wordId(9), dialect_module: "Egyptian", word_arabic: "abc", word_english: "letters", display_order: 0 }),
    );

    const summary = await runPictures(ctx(), options({ limit: 1 }));

    expect(summary.unfileable).toHaveLength(1);
    expect(asked().map((b) => b.gloss)).toEqual(["bread"]);
    expect(imageOf(wordId(9))).toBeNull();
  });

  it("does nothing, and says so, when every word has a picture", async () => {
    backend.db.seed("vocabulary_words", [aVocabularyWord({ image_url: "https://cdn.test/has.png" })]);
    const summary = await runPictures(ctx(), options());
    expect(summary).toMatchObject({ listed: 0, written: 0 });
    expect(backend.callsTo("word-asset")).toEqual([]);
    expect(backend.db.readsOf("word_assets")).toEqual([]);
    expect(formatSummary(summary)[0]).toBe("0 words with no picture.");
  });
});

describe("when something is wrong", () => {
  it("stops at the first word when the function refuses the key", async () => {
    backend.stubFunctionFailure("word-asset", 401, { error: "auth_required" });

    const summary = await runPictures(ctx(), options());

    expect(backend.callsTo("word-asset")).toHaveLength(1);
    expect(summary.stopped).toMatch(/refused the key/);
    expect(summary.written).toBe(0);
    expect(runFailed(summary)).toBe(true);
    expect(formatSummary(summary).at(-1)).toMatch(/^Stopped early: /);
  });

  it("stops when the function is not deployed, or has no image provider", async () => {
    backend.stubFunctionFailure("word-asset", 404, { message: "Function not found" });
    expect((await runPictures(ctx(), options())).stopped).toMatch(/not deployed/);

    backend.stubFunctionFailure("word-asset", 503, { error: "ai_unconfigured", message: "Image generation is not configured right now." });
    const summary = await runPictures(ctx(), options());
    expect(summary.stopped).toMatch(/no image provider configured/);
    expect(backend.callsTo("word-asset")).toHaveLength(2);
  });

  it("stops, and writes nothing, when the deployed function drew without the authored scene", async () => {
    // A function that does not know the trusted path would draw every word
    // from its gloss, at full price. The first answer already says so.
    backend.stubFunction("word-asset", () => ({
      asset: { id: "a", source: "generated" },
      url: "https://cdn.test/gloss-only.png",
      cached: false,
      stored: true,
    }));

    const summary = await runPictures(ctx(), options({ dialect: "Gulf", stage: 1 }));

    expect(backend.callsTo("word-asset")).toHaveLength(1);
    expect(summary.stopped).toMatch(/without the authored scene/);
    expect(imageOf(wordId(0))).toBeNull();
    expect(summary.written).toBe(0);
  });

  it("takes a gloss-only picture for a word that has no scene to draw", async () => {
    backend.stubFunction("word-asset", () => ({ asset: null, url: "https://cdn.test/gloss-only.png", cached: false, stored: true }));
    const summary = await runPictures(ctx(), options({ stage: 2 }));
    expect(summary).toMatchObject({ stopped: null, written: 1 });
    expect(imageOf(wordId(4))).toBe("https://cdn.test/gloss-only.png");
  });

  it("stops on a daily cap, which the service role is never charged", async () => {
    backend.stubFunctionCapped("word-asset");
    const summary = await runPictures(ctx(), options());
    expect(summary.stopped).toMatch(/daily cap/);
    expect(backend.callsTo("word-asset")).toHaveLength(1);
  });

  it("leaves a word the model could not draw for another run, and goes on", async () => {
    backend.stubFunction("word-asset", ({ body }) => {
      const gloss = String((body as { gloss: string }).gloss);
      return gloss === "coffee"
        ? { error: "IMAGE_GENERATION_FAILED", fallback: true, message: 'Could not make a picture for "coffee" — please try again.' }
        : drawn(`https://cdn.test/drawn/${gloss}.png`);
    });

    const summary = await runPictures(ctx(), options({ dialect: "Gulf", stage: 1 }));

    expect(imageOf(wordId(0))).toBeNull();
    expect(imageOf(wordId(1))).toBe("https://cdn.test/drawn/tea.png");
    expect(summary.failed).toEqual([
      { id: wordId(0), word: expect.stringContaining("coffee"), reason: expect.stringMatching(/Could not make a picture/) },
    ]);
    expect(summary.stopped).toBeNull();
    expect(runFailed(summary)).toBe(true);
  });

  it("skips a word the function turns away without counting it as a failure", async () => {
    backend.stubFunction("word-asset", ({ body }) => {
      const gloss = String((body as { gloss: string }).gloss);
      return gloss === "coffee"
        ? { status: 400, body: { error: "invalid_key", message: "A known kind and an Arabic word are required." } }
        : drawn(`https://cdn.test/drawn/${gloss}.png`);
    });

    const summary = await runPictures(ctx(), options({ dialect: "Gulf", stage: 1 }));

    expect(summary.skipped).toHaveLength(1);
    expect(summary.failed).toEqual([]);
    expect(summary.written).toBe(1);
    expect(runFailed(summary)).toBe(false);
  });

  it("gives up after a run of failures instead of failing every word in turn", async () => {
    backend.db.seed(
      "vocabulary_words",
      Array.from({ length: 12 }, (_, index) =>
        aVocabularyWord({ id: wordId(index), word_arabic: "كلمة", word_english: `word ${index}`, display_order: index }),
      ),
    );
    backend.stubFunctionFailure("word-asset", 500, { error: "Failed to upload picture: bucket full" });

    const summary = await runPictures(ctx(), options());

    expect(backend.callsTo("word-asset")).toHaveLength(MAX_CONSECUTIVE_FAILURES);
    expect(summary.failed).toHaveLength(MAX_CONSECUTIVE_FAILURES);
    expect(summary.stopped).toMatch(/failed in a row.*bucket full/);
  });

  it("counts a failure in a row only while it is in a row", async () => {
    backend.db.seed(
      "vocabulary_words",
      Array.from({ length: 12 }, (_, index) =>
        aVocabularyWord({ id: wordId(index), word_arabic: "كلمة", word_english: `word ${index}`, display_order: index }),
      ),
    );
    let call = 0;
    backend.stubFunction("word-asset", () =>
      call++ % 2 === 0 ? { status: 500, body: { error: "flaky" } } : drawn(`https://cdn.test/${call}.png`),
    );

    const summary = await runPictures(ctx(), options());

    expect(summary.stopped).toBeNull();
    expect(summary.failed).toHaveLength(6);
    expect(summary.written).toBe(6);
  });

  it("treats a call that never answered as that word's failure", async () => {
    const offline: RunContext = {
      ...ctx(),
      fetch: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    };
    const result = await ensurePicture(offline, planWord({
      id: "w",
      word_arabic: "قهوة",
      word_english: "coffee",
      dialect_module: "Gulf",
      image_scene_description: null,
      lesson_id: null,
      display_order: 1,
    }) as Parameters<typeof ensurePicture>[1]);
    expect(result).toEqual({ ok: false, fatal: false, skip: false, reason: "fetch failed" });
  });

  it("fails the run when a row cannot be written, rather than drawing on", async () => {
    backend.db.failWrites("vocabulary_words", 403, { message: "permission denied for table vocabulary_words" });
    await expect(runPictures(ctx(), options())).rejects.toThrow(/could not write the picture onto .*permission denied/);
    expect(backend.callsTo("word-asset")).toHaveLength(1);
  });
});
