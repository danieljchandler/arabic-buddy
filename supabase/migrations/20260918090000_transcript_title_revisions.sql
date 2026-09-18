-- A reviewer may now correct the video's title, so the audit trail has to be
-- able to say so.
--
-- `transcript_line_revisions.field` is a closed set and the title is the field
-- a learner sees before they have watched anything: the pipeline names a clip
-- off its own transcript, which is exactly the guess a native speaker is there
-- to overrule. Letting the title change without the log recording it would make
-- the one user-visible label the only thing on the row with no history.
--
-- Same shape as 20260824130000_dialect_subvarieties.sql: Postgres has no
-- ALTER ... MODIFY CHECK, so the constraint is dropped and re-added under the
-- name Postgres generated for the inline column CHECK in
-- 20260824090100_transcript_review.sql.
--
-- Writes still go through the `transcript-review` edge function under the
-- service role — `discover_videos` UPDATE stays admin/content_reviewer only, so
-- the title joins the function's column allow-list rather than the RLS policy.
-- `published` is still not on that list.
ALTER TABLE public.transcript_line_revisions
  DROP CONSTRAINT IF EXISTS transcript_line_revisions_field_check;

ALTER TABLE public.transcript_line_revisions
  ADD CONSTRAINT transcript_line_revisions_field_check CHECK (field IN (
    'arabic', 'translation', 'literal', 'timing', 'structure',
    'cultural_context', 'grammar_points', 'vocabulary',
    'dialect', 'dialect_subvariety', 'dialect_features',
    'title', 'title_arabic'
  ));
