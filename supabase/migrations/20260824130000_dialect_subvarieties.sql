-- Sub-dialect classification on a reviewed video.
--
-- `discover_videos.dialect` stops at the country — "Saudi", "Kuwaiti",
-- "Egyptian" — which is about the resolution of a passport rather than of a
-- dialect. A Jeddah clip and a Riyadh clip land on the same label, a Ṣaʿīdi
-- clip and a Cairene one land on the same label, and every generator that
-- conditions on that label then teaches two systems at once and calls it one.
--
-- The pipeline cannot fix this: guessing Hijazi from Najdi off a thirty-second
-- clip is exactly the judgement it is worst at. A native reviewer makes it in a
-- second. So these two columns are written from the review workspace, through
-- `transcript-review` under the service role, like every other reviewer write.
--
-- Both are deliberately free of a CHECK constraint. The valid ids live in
-- supabase/functions/_shared/dialectSubvarieties.ts, which is where the
-- taxonomy is edited and where the write path validates against it; a second
-- copy in SQL would need a migration every time a variety is added and would
-- go stale the first time somebody forgot.

ALTER TABLE public.discover_videos
  -- The `id` of an entry in DIALECT_SUBVARIETIES for this row's `dialect`.
  -- NULL means nobody has judged it yet, which is a different and more honest
  -- statement than defaulting to the country's biggest variety.
  ADD COLUMN IF NOT EXISTS dialect_subvariety TEXT,
  -- What actually makes this clip sound like that variety: an array of
  -- { category, subvariety, title, arabic, lineId, explanation, contrast }.
  -- Kept apart from `grammar_points` on purpose — those describe the grammar a
  -- learner is meant to take away, these describe what places the speaker, and
  -- most of them (a ق, a borrowing, an intonation contour) are not grammar at
  -- all.
  ADD COLUMN IF NOT EXISTS dialect_features JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.discover_videos.dialect_subvariety IS
  'Sub-variety id under `dialect` (e.g. hijazi, saidi, tihami). Set by a native reviewer, never by the pipeline. Valid ids: supabase/functions/_shared/dialectSubvarieties.ts.';

COMMENT ON COLUMN public.discover_videos.dialect_features IS
  'Reviewer-authored notes on what marks this clip as its sub-variety. Array of { category, subvariety, title, arabic, lineId, explanation, contrast }.';

-- Partial, because the column is NULL on every video until a reviewer gets to
-- it and an index over a mostly-NULL column is mostly dead weight. The read it
-- serves is "show me the Hijazi clips", which is the whole reason for setting
-- it.
CREATE INDEX IF NOT EXISTS discover_videos_dialect_subvariety_idx
  ON public.discover_videos (dialect_subvariety)
  WHERE dialect_subvariety IS NOT NULL;

-- ── The audit trail has to be able to describe these ────────────────────────
--
-- `transcript_line_revisions.field` is a closed set, and a reviewer's change to
-- the dialect classification is exactly the kind of change the log exists for:
-- re-labelling a video from Najdi to Hijazi silently would be worse than not
-- being able to re-label it at all. Three new values, so the same save that
-- moves a video also says so.
--
-- The constraint is dropped and re-added rather than altered because Postgres
-- has no ALTER ... MODIFY CHECK; the name is the one Postgres generated for the
-- inline column CHECK in 20260824090100_transcript_review.sql.
ALTER TABLE public.transcript_line_revisions
  DROP CONSTRAINT IF EXISTS transcript_line_revisions_field_check;

ALTER TABLE public.transcript_line_revisions
  ADD CONSTRAINT transcript_line_revisions_field_check CHECK (field IN (
    'arabic', 'translation', 'literal', 'timing', 'structure',
    'cultural_context', 'grammar_points', 'vocabulary',
    'dialect', 'dialect_subvariety', 'dialect_features'
  ));
