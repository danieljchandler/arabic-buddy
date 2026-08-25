ALTER TABLE public.discover_videos
  ADD COLUMN IF NOT EXISTS dialect_subvariety TEXT,
  ADD COLUMN IF NOT EXISTS dialect_features JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.discover_videos.dialect_subvariety IS
  'Sub-variety id under `dialect` (e.g. hijazi, saidi, tihami). Set by a native reviewer, never by the pipeline. Valid ids: supabase/functions/_shared/dialectSubvarieties.ts.';

COMMENT ON COLUMN public.discover_videos.dialect_features IS
  'Reviewer-authored notes on what marks this clip as its sub-variety. Array of { category, subvariety, title, arabic, lineId, explanation, contrast }.';

CREATE INDEX IF NOT EXISTS discover_videos_dialect_subvariety_idx
  ON public.discover_videos (dialect_subvariety)
  WHERE dialect_subvariety IS NOT NULL;

ALTER TABLE public.transcript_line_revisions
  DROP CONSTRAINT IF EXISTS transcript_line_revisions_field_check;

ALTER TABLE public.transcript_line_revisions
  ADD CONSTRAINT transcript_line_revisions_field_check CHECK (field IN (
    'arabic', 'translation', 'literal', 'timing', 'structure',
    'cultural_context', 'grammar_points', 'vocabulary',
    'dialect', 'dialect_subvariety', 'dialect_features'
  ));