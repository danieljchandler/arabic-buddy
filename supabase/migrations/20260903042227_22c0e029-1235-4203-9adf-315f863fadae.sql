ALTER TABLE public.word_reviews
  ADD COLUMN IF NOT EXISTS last_result text;

CREATE TABLE public.review_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  deck text NOT NULL CHECK (deck IN ('word', 'set_phrase')),
  card_id uuid NOT NULL,
  item_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('recognition', 'production')),
  rating text CHECK (rating IN ('again', 'hard', 'good', 'easy')),
  stability_before numeric,
  stability_after numeric,
  difficulty_before numeric,
  difficulty_after numeric,
  elapsed_days numeric,
  scheduled_days integer,
  repetitions_after integer,
  reviewed_at timestamptz NOT NULL,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_review_log_user_time
  ON public.review_log (user_id, reviewed_at);
CREATE INDEX idx_review_log_card
  ON public.review_log (deck, card_id, reviewed_at);

GRANT SELECT ON public.review_log TO authenticated;
GRANT ALL ON public.review_log TO service_role;

ALTER TABLE public.review_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own review log"
  ON public.review_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.log_word_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.last_reviewed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.last_reviewed_at IS DISTINCT FROM OLD.last_reviewed_at) THEN
    INSERT INTO public.review_log (
      user_id, deck, card_id, item_id, direction, rating,
      stability_before, stability_after, difficulty_before, difficulty_after,
      elapsed_days, scheduled_days, repetitions_after, reviewed_at
    ) VALUES (
      NEW.user_id, 'word', NEW.id, NEW.word_id, 'recognition', NEW.last_result,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.ease_factor END,
      NEW.ease_factor,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.difficulty END,
      NEW.difficulty,
      CASE WHEN TG_OP = 'UPDATE' AND OLD.last_reviewed_at IS NOT NULL
           THEN EXTRACT(EPOCH FROM (NEW.last_reviewed_at - OLD.last_reviewed_at)) / 86400.0 END,
      CASE WHEN TG_OP = 'UPDATE' AND OLD.last_reviewed_at IS NOT NULL THEN OLD.interval_days END,
      NEW.repetitions,
      NEW.last_reviewed_at
    );
  END IF;

  IF NEW.production_last_reviewed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.production_last_reviewed_at IS DISTINCT FROM OLD.production_last_reviewed_at) THEN
    INSERT INTO public.review_log (
      user_id, deck, card_id, item_id, direction, rating,
      stability_before, stability_after, difficulty_before, difficulty_after,
      elapsed_days, scheduled_days, repetitions_after, reviewed_at
    ) VALUES (
      NEW.user_id, 'word', NEW.id, NEW.word_id, 'production', NEW.last_result,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.production_ease_factor END,
      NEW.production_ease_factor,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.production_difficulty END,
      NEW.production_difficulty,
      CASE WHEN TG_OP = 'UPDATE' AND OLD.production_last_reviewed_at IS NOT NULL
           THEN EXTRACT(EPOCH FROM (NEW.production_last_reviewed_at - OLD.production_last_reviewed_at)) / 86400.0 END,
      CASE WHEN TG_OP = 'UPDATE' AND OLD.production_last_reviewed_at IS NOT NULL THEN OLD.production_interval_days END,
      NEW.production_repetitions,
      NEW.production_last_reviewed_at
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.log_word_review() FROM public;

DROP TRIGGER IF EXISTS trg_log_word_review ON public.word_reviews;
CREATE TRIGGER trg_log_word_review
  AFTER INSERT OR UPDATE ON public.word_reviews
  FOR EACH ROW EXECUTE FUNCTION public.log_word_review();

CREATE OR REPLACE FUNCTION public.phrase_quality_to_rating(quality integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN quality IS NULL THEN NULL
    WHEN quality >= 5 THEN 'easy'
    WHEN quality >= 4 THEN 'good'
    WHEN quality >= 3 THEN 'hard'
    ELSE 'again'
  END;
$$;

CREATE OR REPLACE FUNCTION public.log_set_phrase_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.last_reviewed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.last_reviewed_at IS DISTINCT FROM OLD.last_reviewed_at) THEN
    INSERT INTO public.review_log (
      user_id, deck, card_id, item_id, direction, rating,
      stability_before, stability_after, difficulty_before, difficulty_after,
      elapsed_days, scheduled_days, repetitions_after, reviewed_at
    ) VALUES (
      NEW.user_id, 'set_phrase', NEW.id, NEW.phrase_id, 'recognition',
      public.phrase_quality_to_rating(NEW.last_quality),
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.ease_factor END,
      NEW.ease_factor,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.difficulty END,
      NEW.difficulty,
      CASE WHEN TG_OP = 'UPDATE' AND OLD.last_reviewed_at IS NOT NULL
           THEN EXTRACT(EPOCH FROM (NEW.last_reviewed_at - OLD.last_reviewed_at)) / 86400.0 END,
      CASE WHEN TG_OP = 'UPDATE' AND OLD.last_reviewed_at IS NOT NULL THEN OLD.interval_days END,
      NEW.repetitions,
      NEW.last_reviewed_at
    );
  END IF;

  IF NEW.production_last_reviewed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.production_last_reviewed_at IS DISTINCT FROM OLD.production_last_reviewed_at) THEN
    INSERT INTO public.review_log (
      user_id, deck, card_id, item_id, direction, rating,
      stability_before, stability_after, difficulty_before, difficulty_after,
      elapsed_days, scheduled_days, repetitions_after, reviewed_at
    ) VALUES (
      NEW.user_id, 'set_phrase', NEW.id, NEW.phrase_id, 'production',
      public.phrase_quality_to_rating(NEW.last_quality),
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.production_ease_factor END,
      NEW.production_ease_factor,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.production_difficulty END,
      NEW.production_difficulty,
      CASE WHEN TG_OP = 'UPDATE' AND OLD.production_last_reviewed_at IS NOT NULL
           THEN EXTRACT(EPOCH FROM (NEW.production_last_reviewed_at - OLD.production_last_reviewed_at)) / 86400.0 END,
      CASE WHEN TG_OP = 'UPDATE' AND OLD.production_last_reviewed_at IS NOT NULL THEN OLD.production_interval_days END,
      NEW.production_repetitions,
      NEW.production_last_reviewed_at
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.log_set_phrase_review() FROM public;

DROP TRIGGER IF EXISTS trg_log_set_phrase_review ON public.user_set_phrases;
CREATE TRIGGER trg_log_set_phrase_review
  AFTER INSERT OR UPDATE ON public.user_set_phrases
  FOR EACH ROW EXECUTE FUNCTION public.log_set_phrase_review();

-- conversation_error_sources
ALTER TABLE public.learner_errors
  DROP CONSTRAINT IF EXISTS learner_errors_source_check;
ALTER TABLE public.learner_errors
  ADD CONSTRAINT learner_errors_source_check
  CHECK (source IN (
    'pronunciation', 'shadow', 'sentence_coach', 'set_phrase_voice', 'quiz',
    'writing', 'monologue', 'mistake_drill', 'chunk_coach',
    'conversation', 'voice'
  ));

-- user_perception_progress
CREATE TABLE public.user_perception_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dialect text NOT NULL DEFAULT 'Gulf',
  contrast_id text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  correct integer NOT NULL DEFAULT 0,
  seconds integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  resurfaced_at timestamptz,
  resurface_attempts integer NOT NULL DEFAULT 0,
  resurface_correct integer NOT NULL DEFAULT 0,
  last_practiced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dialect, contrast_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_perception_progress TO authenticated;
GRANT ALL ON public.user_perception_progress TO service_role;

ALTER TABLE public.user_perception_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own perception progress" ON public.user_perception_progress
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own perception progress" ON public.user_perception_progress
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own perception progress" ON public.user_perception_progress
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own perception progress" ON public.user_perception_progress
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_user_perception_progress_updated_at
  BEFORE UPDATE ON public.user_perception_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_user_perception_progress_user
  ON public.user_perception_progress (user_id, dialect);

-- dialect_word_frequency
CREATE TABLE public.dialect_word_frequency (
  dialect text NOT NULL,
  token text NOT NULL,
  count numeric NOT NULL DEFAULT 0,
  doc_count integer NOT NULL DEFAULT 0,
  zipf numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dialect, token)
);

CREATE INDEX idx_dialect_word_frequency_rank
  ON public.dialect_word_frequency (dialect, count DESC);

GRANT SELECT ON public.dialect_word_frequency TO authenticated;
GRANT ALL ON public.dialect_word_frequency TO service_role;

ALTER TABLE public.dialect_word_frequency ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read word frequency"
  ON public.dialect_word_frequency
  FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE public.vocabulary_words
  ADD COLUMN IF NOT EXISTS frequency_rank integer;
ALTER TABLE public.set_phrases
  ADD COLUMN IF NOT EXISTS frequency_rank integer;

-- profile_fsrs_weights
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS fsrs_weights jsonb,
  ADD COLUMN IF NOT EXISTS fsrs_weights_fitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS fsrs_weights_reviews integer;

-- placement_results
CREATE TABLE public.placement_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dialect text NOT NULL DEFAULT 'Gulf',
  cefr_level text NOT NULL,
  confidence numeric,
  strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  weaknesses jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviews_at_time integer,
  taken_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_placement_results_user
  ON public.placement_results (user_id, dialect, taken_at DESC);

GRANT SELECT, INSERT ON public.placement_results TO authenticated;
GRANT ALL ON public.placement_results TO service_role;

ALTER TABLE public.placement_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own placement results" ON public.placement_results
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own placement results" ON public.placement_results
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- placement_results instruments (C-test)
ALTER TABLE public.placement_results
  ADD COLUMN IF NOT EXISTS instrument text NOT NULL DEFAULT 'placement',
  ADD COLUMN IF NOT EXISTS score numeric,
  ADD COLUMN IF NOT EXISTS detail jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.placement_results
  ALTER COLUMN cefr_level DROP NOT NULL;

ALTER TABLE public.placement_results
  DROP CONSTRAINT IF EXISTS placement_results_instrument_check;
ALTER TABLE public.placement_results
  ADD CONSTRAINT placement_results_instrument_check
  CHECK (instrument IN ('placement', 'c_test'));