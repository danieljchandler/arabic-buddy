-- Per-review event log for the two spaced-repetition decks.
--
-- word_reviews and user_set_phrases store only a card's *current* schedule.
-- Nothing anywhere records the history of ratings that produced it, which
-- means three things the app wants are impossible: fitting FSRS parameters to
-- an individual learner (the maintainers' benchmark puts per-user fitting
-- ahead of two whole algorithm generations — docs/language-learning-research-
-- 2026-09.md §1), measuring a learner's real retention curve rather than a
-- lifetime average, and calibrating any threshold "from our own data", which
-- docs/plateau-plan-2026-09.md promises in several places.
--
-- Populated by AFTER INSERT/UPDATE triggers on the two schedule tables rather
-- than by client writes, for two reasons. There are three client paths that
-- write a schedule today (useReview, useSetPhrases, Review.tsx's relearn
-- queue) and a trigger covers all of them plus any future one. And a history
-- the learner could author is worth nothing as a calibration corpus: no client
-- role gets INSERT/UPDATE/DELETE here at all — the same asymmetry as
-- learner_errors and monologue_attempts, enforced by the database itself.
--
-- A row is written only when a direction's last_reviewed_at changes. A
-- schedule edit that leaves it alone (a mnemonic saved, is_leech toggled, the
-- production direction being *unlocked* by a good recognition rating) is not a
-- review and is not logged.

-- The generated types have always listed word_reviews.last_result, but no
-- migration creates it and the review path never wrote it (only exportData.ts
-- reads it). The trigger reads the rating from it, so create it where it is
-- missing and start writing it (useReview.buildReviewUpdate).
ALTER TABLE public.word_reviews
  ADD COLUMN IF NOT EXISTS last_result text;

CREATE TABLE public.review_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  deck text NOT NULL CHECK (deck IN ('word', 'set_phrase')),
  -- The schedule row (word_reviews.id / user_set_phrases.id) and the item it
  -- schedules (word_id / phrase_id). Both, so the log survives a card being
  -- deleted and re-added, and so it can be joined either way.
  card_id uuid NOT NULL,
  item_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('recognition', 'production')),
  -- NULL when the writer did not record one (rows written before the app
  -- started setting last_result). The optimizer skips those.
  rating text CHECK (rating IN ('again', 'hard', 'good', 'easy')),
  -- FSRS memory state either side of the review. ease_factor holds stability
  -- (days) in this schema — see spacedRepetition.ts.
  stability_before numeric,
  stability_after numeric,
  difficulty_before numeric,
  difficulty_after numeric,
  -- Days since the previous review in this direction; NULL on the first.
  elapsed_days numeric,
  -- The interval the previous review scheduled; what "on time" means for this
  -- one. NULL on the first review.
  scheduled_days integer,
  repetitions_after integer,
  reviewed_at timestamptz NOT NULL,
  -- Not available server-side; reserved for a later client-supplied write via
  -- the schedule row. Nullable so the trigger never needs it.
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The optimizer reads one learner's whole history in review order; the stats
-- views read one learner's recent window.
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

-- ---------------------------------------------------------------------------
-- word_reviews → review_log
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so the insert into review_log succeeds for an authenticated
-- caller who holds no INSERT grant on it. That is the point: the only way a
-- row gets here is through a real schedule write.
CREATE OR REPLACE FUNCTION public.log_word_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Recognition (the audio channel shares this schedule — reviewOrder.ts).
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

  -- Production. Never created cold (useReview refuses), so only UPDATE can
  -- change its last_reviewed_at; guarded the same way regardless.
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

-- ---------------------------------------------------------------------------
-- user_set_phrases → review_log
-- ---------------------------------------------------------------------------
-- The phrase deck stores a 0–5 quality (last_quality) rather than a rating;
-- this is phraseRating() from useSetPhrases.ts, kept in step by
-- src/test/reviewLog.test.ts.
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
