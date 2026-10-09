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

  // The content-library bridge (ingest-from-library). Merged from a branch,
  // so absent from the live project until applied there — the exact hazard
  // this list exists to name. Delete these three once a types regeneration
  // carries the columns.
  ...["library_item_id", "creator_name", "creator_handle"].map((column) => ({
    table: "discover_videos",
    column,
    migration: "20260919120000_library_bridge",
  })),

  // "How you review" (flashcards or quiz), on the profile so it follows the
  // learner across devices. Merged from a branch, so absent from the live
  // project until applied there. Delete this once a types regeneration
  // carries the column.
  { table: "profiles", column: "review_style", migration: "20261009120000_profile_review_style" },

  // The shared asset store (quiz Phase 2): one picture, recording or jingle
  // per word for every learner. Merged from a branch, so the whole table is
  // absent from the live project — and from types.ts — until applied there;
  // until then every lookup misses and the generators behave as before. Delete
  // these once a types regeneration carries the table (it has anon and
  // authenticated SELECT grants, so the generator will pick it up).
  ...[
    "id",
    "concept_key",
    "kind",
    "dialect",
    "style_version",
    "url",
    "payload",
    "meta",
    "source",
    "approved_at",
    "created_at",
  ].map((column) => ({ table: "word_assets", column, migration: "20261009130000_word_assets" })),

  // The post-video debrief (20261004120000_video_debrief) and the daily recap
  // (20261005120000_learner_recaps) were pinned here from their merge until
  // 2026-10-05, when Lovable applied both to the live project and the types
  // regeneration that followed carried `video_study_guides`,
  // `video_word_lookups`, `user_vocabulary.source_video_id` and
  // `learner_recaps`. Their entries are deleted per the staleness check in
  // typesDrift.test.ts.
];


/** Extra columns for a table, as a set. */
export function extraColumnsFor(table: string): string[] {
  return COLUMNS_MISSING_FROM_TYPES.filter((entry) => entry.table === table).map(
    (entry) => entry.column,
  );
}
