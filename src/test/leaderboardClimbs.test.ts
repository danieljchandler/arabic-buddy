import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LADDER_THRESHOLDS } from "@/lib/quizLadder";

/**
 * The leaderboard's climbs are counted in SQL (`leaderboard_climbs`, quiz
 * Phase 7.4), with the quiz ladder's steps written out in
 * `quiz_ladder_step`. The ladder's thresholds are a first guess meant to be
 * tuned (quiz Phase 8), and a retune of `LADDER_THRESHOLDS` that the SQL did
 * not follow would count climbs on a ladder the quiz no longer asks. This
 * reads the migration and holds its numbers to the TypeScript, and pins the
 * rules the count rests on: the word deck only, lapses never, and only the
 * learners who chose to be on the board.
 *
 * Shallow on purpose: the behaviour is checked against a real Postgres when
 * the migrations are replayed (`migrationReplay.test.ts`, CI), and the same
 * rule in TypeScript (`src/lib/ladderClimbs.ts`) is what the in-memory backend
 * answers with.
 */

const MIGRATION = resolve(__dirname, "../../supabase/migrations/20261010120000_leaderboard_climbs.sql");
const sql = readFileSync(MIGRATION, "utf8");
const stepFunction = sql.slice(
  sql.indexOf("CREATE OR REPLACE FUNCTION public.quiz_ladder_step"),
  sql.indexOf("GRANT EXECUTE ON FUNCTION public.quiz_ladder_step"),
);
const climbsFunction = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.leaderboard_climbs"));

/** The number a `>= n THEN step` (production) or `< n THEN step` (recognition) line gives `step`. */
function threshold(op: ">=" | "<", step: number): number {
  const match = stepFunction.match(new RegExp(`${op}\\s*(\\d+(?:\\.\\d+)?)\\s+THEN\\s+${step}\\b`));
  if (!match) throw new Error(`No "${op} n THEN ${step}" in quiz_ladder_step`);
  return Number(match[1]);
}

describe("quiz_ladder_step", () => {
  it("climbs the production steps on LADDER_THRESHOLDS", () => {
    expect(threshold(">=", 10)).toBe(LADDER_THRESHOLDS.storyDays);
    expect(threshold(">=", 9)).toBe(LADDER_THRESHOLDS.replyDays);
    expect(threshold(">=", 8)).toBe(LADDER_THRESHOLDS.sentenceDays);
  });

  it("climbs the recognition steps on LADDER_THRESHOLDS", () => {
    expect(threshold("<", 1)).toBe(LADDER_THRESHOLDS.firstLookDays);
    expect(threshold("<", 2)).toBe(LADDER_THRESHOLDS.gapDays);
    expect(threshold("<", 3)).toBe(LADDER_THRESHOLDS.pictureDays);
    expect(threshold("<", 4)).toBe(LADDER_THRESHOLDS.hearDays);
    expect(threshold("<", 5)).toBe(LADDER_THRESHOLDS.wordDays);
  });

  it("puts a card with no repetitions on the first step, as rungForMemory does", () => {
    expect(stepFunction).toMatch(/COALESCE\(_repetitions, 0\) <= 0 OR [^\n]* < \d+ THEN 1/);
  });
});

describe("leaderboard_climbs", () => {
  it("counts the word deck's reviews this week, never one stamped in the future, and only a Hard, Good or Easy", () => {
    expect(climbsFunction).toMatch(/r\.deck = 'word'/);
    expect(climbsFunction).toMatch(/r\.reviewed_at >= _week_start/);
    expect(climbsFunction).toMatch(/r\.reviewed_at < LEAST\(_week_start \+ interval '7 days', now\(\) \+ interval '1 minute'\)/);
    expect(climbsFunction).toMatch(/r\.rating IN \('hard', 'good', 'easy'\)/);
  });

  it("counts a card at most once a day in each direction", () => {
    expect(climbsFunction).toMatch(/COUNT\(DISTINCT \(r\.card_id, r\.direction, \(r\.reviewed_at AT TIME ZONE 'utc'\)::date\)\)/);
  });

  it("keeps the step function inlinable: plain SQL, no SET clause", () => {
    expect(stepFunction).toMatch(/LANGUAGE sql/);
    expect(stepFunction).not.toMatch(/\bSET\b/);
  });

  it("answers only for learners who chose to be on the board, and a page of them at a time", () => {
    expect(climbsFunction).toMatch(/p\.show_on_leaderboard = true/);
    expect(climbsFunction).toMatch(/cardinality\(_user_ids\) > 100/);
  });

  it("is a definer function anyone signed in may call, and nobody else by default", () => {
    expect(climbsFunction).toMatch(/SECURITY DEFINER/);
    expect(climbsFunction).toMatch(/REVOKE ALL ON FUNCTION public\.leaderboard_climbs\(uuid\[\]\) FROM public;/);
  });
});
