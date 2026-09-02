import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installSupabaseFetch } from "@/test/support/transports/vitest";
import { aReviewLog, TEST_USER_ID } from "@/test/support/factories";
import { supabase } from "@/integrations/supabase/client";
import { phraseRating } from "@/hooks/useSetPhrases";

/**
 * The review event log (20260902000000_review_log.sql).
 *
 * The table is written only by database triggers, so the emulator — which has
 * no triggers — cannot show a review producing a row. What it *can* show is
 * that the table exists in the schema the emulator derives from the generated
 * types, that a row shaped like the trigger's output round-trips through the
 * real client, and that the SQL the trigger uses to turn a set-phrase quality
 * into a rating still says what the TypeScript does. The behaviour of the
 * trigger itself is exercised by the migration replay against real Postgres
 * (src/test/migrationReplay.test.ts) and was checked by hand when it landed.
 */

const MIGRATION = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20260902000000_review_log.sql"),
  "utf8",
);

describe("review_log migration — access rules", () => {
  it("creates the table and both triggers", () => {
    expect(MIGRATION).toMatch(/CREATE TABLE public\.review_log/);
    expect(MIGRATION).toMatch(/AFTER INSERT OR UPDATE ON public\.word_reviews/);
    expect(MIGRATION).toMatch(/AFTER INSERT OR UPDATE ON public\.user_set_phrases/);
  });

  it("gives clients read access only — no client role can write history", () => {
    // Every policy on review_log must be FOR SELECT. A learner who could
    // INSERT here could author the calibration corpus.
    const policies = [...MIGRATION.matchAll(/CREATE POLICY[^;]*ON public\.review_log[^;]*;/gs)].map(
      (m) => m[0],
    );
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) expect(policy).toMatch(/FOR SELECT/);
    expect(MIGRATION).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL) ON public\.review_log TO authenticated/);
    expect(MIGRATION).toMatch(/GRANT SELECT ON public\.review_log TO authenticated/);
  });

  it("creates word_reviews.last_result where it is missing, since no earlier migration does", () => {
    expect(MIGRATION).toMatch(/ALTER TABLE public\.word_reviews\s+ADD COLUMN IF NOT EXISTS last_result text/);
  });

  it("logs from SECURITY DEFINER functions, so the insert does not need a client grant", () => {
    // Count definitions, not mentions — the migration's comments explain the
    // choice in the same words.
    const definers = MIGRATION.match(/LANGUAGE plpgsql\s+SECURITY DEFINER/g) ?? [];
    expect(definers.length).toBe(2);
  });
});

describe("review_log migration — set-phrase quality → rating parity", () => {
  /**
   * Rebuild the SQL CASE as a function and compare it with phraseRating()
   * across the whole quality range. If someone changes one side, this is what
   * says the log's ratings have drifted from what the deck actually did.
   */
  const sqlFn = MIGRATION.match(/FUNCTION public\.phrase_quality_to_rating[\s\S]*?\$\$;/)?.[0];
  const thresholds = [...(sqlFn ?? "").matchAll(/WHEN quality >= (\d+) THEN '(\w+)'/g)].map((m) => ({
    min: Number(m[1]),
    rating: m[2],
  }));
  const fallback = sqlFn?.match(/ELSE '(\w+)'/)?.[1];

  const sqlRating = (quality: number): string => {
    for (const { min, rating } of thresholds) if (quality >= min) return rating;
    return fallback ?? "";
  };

  it("parsed the CASE out of the migration", () => {
    expect(thresholds.length).toBe(3);
    expect(fallback).toBe("again");
  });

  it.each([-1, 0, 1, 2, 3, 4, 5, 6])("agrees with phraseRating for quality %i", (quality) => {
    expect(sqlRating(quality)).toBe(phraseRating(quality));
  });
});

describe("review_log — emulator round-trip", () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it("persists a trigger-shaped row and reads it back through the real client", async () => {
    const { backend, restore: r } = installSupabaseFetch({ signedInAs: TEST_USER_ID });
    restore = r;
    backend.db.seed("review_log", [
      aReviewLog(),
      aReviewLog({ id: 1001, direction: "production", rating: "hard" }),
      aReviewLog({ id: 1002, user_id: "someone-else" }),
    ]);

    const { data, error } = await supabase
      .from("review_log")
      .select("*")
      .eq("user_id", TEST_USER_ID)
      .order("reviewed_at");

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data?.map((row) => row.direction)).toEqual(["recognition", "production"]);
    // The memory-state columns the optimizer needs survive the round-trip.
    expect(data?.[0]).toMatchObject({
      deck: "word",
      rating: "good",
      stability_before: 3.17,
      stability_after: 8.2,
      elapsed_days: 3,
      scheduled_days: 3,
    });
  });
});
