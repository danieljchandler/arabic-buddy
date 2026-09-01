CREATE TABLE public.monologue_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dialect text NOT NULL DEFAULT 'Gulf',
  prompt_text text,
  duration_ms integer NOT NULL,
  transcript text NOT NULL DEFAULT '',
  word_count integer NOT NULL DEFAULT 0,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  asr_provider text NOT NULL DEFAULT 'soniox',
  timings_available boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_monologue_attempts_user_recent
  ON public.monologue_attempts (user_id, dialect, created_at DESC);

GRANT SELECT ON public.monologue_attempts TO authenticated;
GRANT ALL ON public.monologue_attempts TO service_role;

ALTER TABLE public.monologue_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own monologue attempts"
  ON public.monologue_attempts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

ALTER TABLE public.user_set_phrases
  ADD COLUMN IF NOT EXISTS production_ease_factor numeric NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS production_difficulty numeric NOT NULL DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS production_interval_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_repetitions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_lapses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_next_review_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS production_last_reviewed_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_user_set_phrases_production_due
  ON public.user_set_phrases (user_id, production_next_review_at)
  WHERE production_next_review_at IS NOT NULL;

CREATE TABLE public.shadow_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dialect text NOT NULL DEFAULT 'Gulf',
  clip_ref text NOT NULL,
  rep integer NOT NULL DEFAULT 1,
  reference_text text NOT NULL,
  recognized_text text NOT NULL DEFAULT '',
  transcript_similarity numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shadow_attempts_user_clip
  ON public.shadow_attempts (user_id, clip_ref, created_at DESC);

GRANT SELECT ON public.shadow_attempts TO authenticated;
GRANT ALL ON public.shadow_attempts TO service_role;

ALTER TABLE public.shadow_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own shadow attempts"
  ON public.shadow_attempts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

ALTER TABLE public.learner_errors
  DROP CONSTRAINT IF EXISTS learner_errors_source_check;
ALTER TABLE public.learner_errors
  ADD CONSTRAINT learner_errors_source_check
  CHECK (source IN (
    'pronunciation', 'shadow', 'sentence_coach', 'set_phrase_voice', 'quiz',
    'writing', 'monologue', 'mistake_drill', 'chunk_coach'
  ));