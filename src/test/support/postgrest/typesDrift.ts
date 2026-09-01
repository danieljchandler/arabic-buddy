/**
 * Columns the migrations create that `src/integrations/supabase/types.ts` does
 * not list.
 *
 * The generated types are stale. Found by replaying all 137 migrations against
 * a real Postgres and diffing the result against the file — 24 columns exist in
 * the database and are missing from the types.
 *
 * That matters beyond the test suite: TypeScript does not know these columns
 * exist, so any code touching one needs a cast, which is part of why the repo
 * carries several hundred `no-explicit-any` errors. (`word_reviews.difficulty`
 * was the clearest case until a types regeneration picked it up — FSRS wrote a
 * card's difficulty there with the write typed as `never`.)
 *
 * The fix is to regenerate the types, which needs Supabase access. Until then
 * the emulator has to accept these or it would reject writes the real database
 * accepts. Each entry names the migration that creates it, and
 * `src/test/typesDrift.test.ts` checks that claim — so this cannot quietly
 * become a place to excuse a genuine typo.
 */

export interface DriftedColumn {
  table: string;
  column: string;
  /** The migration file that creates it, without the `.sql`. */
  migration: string;
}

export const COLUMNS_MISSING_FROM_TYPES: DriftedColumn[] = [
  // The lesson-content / authoring-metadata drift this list used to pin
  // (lessons, vocabulary_words, saved_transcriptions, curriculum_chat_approvals)
  // is resolved: 20260831100000_reconcile_lessons_shapes.sql converges both
  // table shapes and types.ts now lists those columns, so those entries are
  // deleted per the staleness check in typesDrift.test.ts.

  // Service-role-only telemetry tables, absent from the types entirely because
  // they carry no anon or authenticated grants.
  ...["id", "user_id", "endpoint", "created_at"].map((column) => ({
    table: "fanar_usage",
    column,
    migration: "20260226000000_fanar_usage",
  })),
];


/** Extra columns for a table, as a set. */
export function extraColumnsFor(table: string): string[] {
  return COLUMNS_MISSING_FROM_TYPES.filter((entry) => entry.table === table).map(
    (entry) => entry.column,
  );
}
