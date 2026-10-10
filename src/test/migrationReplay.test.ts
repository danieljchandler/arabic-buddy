import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { rungForMemory } from "@/lib/quizLadder";

/**
 * Can the database be rebuilt from the migrations in this repo?
 *
 * The in-memory backend and the static schema check both take the *current*
 * schema as given. Neither can tell you whether the history that produced it
 * still replays — and a migration set that only works against the one database
 * it grew on is a disaster-recovery problem, a new-environment problem and a
 * local-development problem, all of which stay invisible until someone tries.
 *
 * Needs a PostgreSQL server. Skipped with a clear message when DATABASE_URL is
 * unset, so a normal `npm test` is unaffected; CI runs it against a service
 * container, where it is mandatory.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const REPO_ROOT = resolve(__dirname, "../..");

interface BuildResult {
  total: number;
  failures: Array<{ file: string; error: string }>;
  tables: string[];
}

/**
 * Migrations that do not replay from scratch today.
 *
 * Five try to create something an earlier migration already created; two
 * reference tables (processed_videos, review_streaks) that at their point in
 * the sequence no migration had created. 20260904120000_out_of_band_tables.sql
 * now creates both, but it sorts after them, so those two still fail on a
 * fresh replay and their policies are restated in the later file instead.
 *
 * The list is pinned so it cannot grow. Shrinking it is the goal.
 */
const KNOWN_REPLAY_FAILURES = [
  "20260310162719_f1a34d54-03ec-4147-b0c7-3e05cb33bb72.sql",
  "20260312221908_25061ea3-ebd3-4d38-88d2-93ecb71be95a.sql",
  "20260320182853_6ba0bfc1-bcfb-4e7f-a3c8-99b9489e5084.sql",
  "20260321143044_9fae3e9f-1f44-478b-895f-db560d3b03dc.sql",
  "20260321182338_c12bdf4f-7518-40cb-bf1b-f02d1c61009e.sql",
  "20260529150401_dc0b25a8-3051-4445-a8be-cd323f128c64.sql",
  "20260529155315_a303684f-1e60-4e83-8c60-8f228e46c637.sql",
];

/**
 * Tables the app reads that replaying the migrations does not produce.
 *
 * Empty since 20260904120000_out_of_band_tables.sql, which restated the five
 * dashboard-only tables (and the story-videos bucket) with IF NOT EXISTS.
 * src/test/tablesInMigrations.test.ts keeps it empty without a database.
 */
const KNOWN_MISSING_TABLES: string[] = [];

describe.skipIf(!DATABASE_URL)("migration replay", () => {
  let result: BuildResult;

  beforeAll(() => {
    const output = execFileSync("node", [resolve(REPO_ROOT, "contract/build.mjs")], {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
    });
    result = JSON.parse(output) as BuildResult;
  }, 300_000);

  it("applies the prelude and reaches every migration", () => {
    expect(result.total).toBeGreaterThan(130);
  });

  it("builds the schema the app expects", () => {
    // The bulk of the work does replay: this is a floor on how much of the
    // schema a rebuilt database actually gets.
    expect(result.tables.length).toBeGreaterThan(70);
    expect(result.tables).toContain("profiles");
    expect(result.tables).toContain("user_vocabulary");
    expect(result.tables).toContain("word_reviews");
  });

  it("has no replay failures beyond the known ones", () => {
    const unexpected = result.failures
      .map((failure) => failure.file)
      .filter((file) => !KNOWN_REPLAY_FAILURES.includes(file));

    expect(
      unexpected,
      `New migrations fail to replay from scratch:\n` +
        result.failures
          .filter((failure) => unexpected.includes(failure.file))
          .map((failure) => `  ${failure.file}: ${failure.error}`)
          .join("\n"),
    ).toEqual([]);
  });

  it("records which known failures have since been fixed", () => {
    // Fails when the list shrinks, so the pin gets tightened rather than
    // hiding progress.
    const stillFailing = result.failures.map((failure) => failure.file);
    const fixed = KNOWN_REPLAY_FAILURES.filter((file) => !stillFailing.includes(file));

    expect(
      fixed,
      `These migrations replay cleanly now. Remove them from ` +
        `KNOWN_REPLAY_FAILURES so the list keeps meaning something.`,
    ).toEqual([]);
  });

  /**
   * The leaderboard's climbs (quiz Phase 7.4) are counted in SQL with the
   * quiz ladder written out (`quiz_ladder_step`). The static check in
   * leaderboardClimbs.test.ts holds its numbers to LADDER_THRESHOLDS; this
   * runs it, on a grid of memory states either side of every threshold, and
   * runs the count on a seeded week, inside a transaction that is rolled back.
   */
  const sql = (query: string) =>
    execFileSync("psql", [DATABASE_URL!, "-v", "ON_ERROR_STOP=1", "-At", "-c", query], { encoding: "utf8" }).trim();

  it("steps a memory state on the ladder exactly as rungForMemory does", () => {
    const stabilities = [-1, 0, 0.5, 0.99, 1, 2, 3.99, 4, 7.99, 8, 12, 13.99, 14, 15.99, 16, 29.99, 30, 59.99, 60, 400];
    const repetitions = [0, 1, 5];
    const cases = (["recognition", "production"] as const).flatMap((direction) =>
      repetitions.flatMap((reps) => stabilities.map((stability) => ({ direction, reps, stability }))),
    );
    const rows = sql(
      `SELECT public.quiz_ladder_step(s, r, d) FROM (VALUES ${cases
        .map((c) => `(${c.stability}::numeric, ${c.reps}, '${c.direction}')`)
        .join(", ")}) AS t(s, r, d)`,
    ).split("\n");
    expect(rows.map(Number)).toEqual(
      cases.map((c) => rungForMemory({ stability: c.stability, repetitions: c.reps }, c.direction).step),
    );
    // A stability that is missing or not finite reads as none, as it does in TypeScript.
    expect(sql(`SELECT public.quiz_ladder_step(NULL, 3, 'recognition'), public.quiz_ladder_step('NaN', 3, 'production'), public.quiz_ladder_step('Infinity', 3, 'production')`)).toBe("1|7|7");
  });

  it("counts a week's climbs for learners on the board, and nothing else", () => {
    const [a, b, c] = ["a1", "a2", "a3"].map((s) => `00000000-0000-4000-8000-0000000000${s}`);
    const card = "00000000-0000-4000-8000-0000000000c1";
    const log = (user: string, over: string) =>
      `INSERT INTO public.review_log (user_id, deck, card_id, item_id, direction, rating, stability_before, stability_after, repetitions_after, reviewed_at) SELECT '${user}', ${over};`;
    const out = sql(`
      BEGIN;
      INSERT INTO auth.users (id) VALUES ('${a}'), ('${b}'), ('${c}') ON CONFLICT DO NOTHING;
      INSERT INTO public.profiles (user_id) VALUES ('${a}'), ('${b}'), ('${c}') ON CONFLICT (user_id) DO NOTHING;
      UPDATE public.profiles SET show_on_leaderboard = (user_id <> '${c}') WHERE user_id IN ('${a}', '${b}', '${c}');
      ${log(a, `'word', gen_random_uuid(), gen_random_uuid(), 'recognition', 'good', NULL, 3, 1, now()`)}
      ${log(a, `'word', '${card}', gen_random_uuid(), 'recognition', 'good', 3, 5, 2, now()`)}
      ${log(a, `'word', '${card}', gen_random_uuid(), 'recognition', 'good', 3, 5, 2, now()`)}
      ${log(a, `'word', gen_random_uuid(), gen_random_uuid(), 'production', 'good', 12, 20, 3, now()`)}
      ${log(a, `'word', gen_random_uuid(), gen_random_uuid(), 'recognition', 'good', 5, 7, 3, now()`)}
      ${log(a, `'word', gen_random_uuid(), gen_random_uuid(), 'recognition', 'again', 20, 2, 4, now()`)}
      ${log(a, `'word', gen_random_uuid(), gen_random_uuid(), 'recognition', NULL, 3, 1.2, 1, now()`)}
      ${log(a, `'word', gen_random_uuid(), gen_random_uuid(), 'recognition', 'good', 3, 5, 2, date_trunc('week', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc' - interval '1 second'`)}
      ${log(a, `'word', gen_random_uuid(), gen_random_uuid(), 'recognition', 'good', 3, 5, 2, now() + interval '1 day'`)}
      ${log(a, `'set_phrase', gen_random_uuid(), gen_random_uuid(), 'recognition', 'good', 3, 9, 2, now()`)}
      ${log(c, `'word', gen_random_uuid(), gen_random_uuid(), 'recognition', 'good', 3, 5, 2, now()`)}
      SELECT user_id || ':' || climbs_this_week FROM public.leaderboard_climbs(ARRAY['${a}', '${b}', '${c}']::uuid[]) ORDER BY user_id;
      ROLLBACK;
    `);
    // a1: a first graduation, a step up (its card climbing twice today counts
    // once), a production step up. Not a step held, a lapse, an unrated row,
    // last week, a review stamped tomorrow, or a set phrase. a3 is off the board.
    expect(out.split("\n").filter((line) => line.includes(":"))).toEqual([`${a}:3`, `${b}:0`]);
  });

  /**
   * What a curriculum rating was asked as (quiz Phase 8): the rating's write
   * carries it on word_reviews, and the review_log trigger copies it beside
   * the rating, on either schedule; a rating with nothing asked (a flip card)
   * writes nulls, and is logged with none.
   */
  it("logs what a rating was asked as, beside the rating", () => {
    const user = "00000000-0000-4000-8000-0000000000b1";
    const word = "00000000-0000-4000-8000-0000000000b2";
    const out = sql(`
      BEGIN;
      INSERT INTO auth.users (id) VALUES ('${user}') ON CONFLICT DO NOTHING;
      INSERT INTO public.vocabulary_words (id, word_arabic, word_english) VALUES ('${word}', 'سوق', 'market');
      INSERT INTO public.word_reviews (user_id, word_id, ease_factor, repetitions, last_reviewed_at, last_result, last_quiz_format, last_quiz_step)
        VALUES ('${user}', '${word}', 0.5, 1, now() - interval '1 day', 'good', 'cloze-hint', 1);
      UPDATE public.word_reviews
        SET ease_factor = 3, repetitions = 2, last_reviewed_at = now(), last_result = 'hard', last_quiz_format = NULL, last_quiz_step = NULL
        WHERE word_id = '${word}';
      UPDATE public.word_reviews
        SET production_ease_factor = 2, production_last_reviewed_at = now(), last_result = 'good', last_quiz_format = 'speak', last_quiz_step = 7
        WHERE word_id = '${word}';
      SELECT direction || ':' || rating || ':' || coalesce(quiz_format, '-') || ':' || coalesce(quiz_step::text, '-')
        FROM public.review_log WHERE user_id = '${user}' ORDER BY id;
      ROLLBACK;
    `);
    expect(out.split("\n").filter((line) => line.includes(":"))).toEqual([
      "recognition:good:cloze-hint:1",
      "recognition:hard:-:-",
      "production:good:speak:7",
    ]);
  });

  it("records the tables a rebuilt database would be missing", () => {
    const missing = KNOWN_MISSING_TABLES.filter((table) => !result.tables.includes(table));

    // subscribers used to be on this list — _shared/usageCap.ts reads it to
    // decide whether a caller is a paying customer — until a migration finally
    // created it. The two left are admin-side pipelines.
    expect(missing.sort()).toEqual(KNOWN_MISSING_TABLES);
  });
});

describe.skipIf(DATABASE_URL)("migration replay (skipped)", () => {
  it("explains why it did not run", () => {
    // A silent skip reads as a pass. This makes the reason visible in the
    // output of a normal `npm test`.
    expect(DATABASE_URL).toBeUndefined();
  });
});
