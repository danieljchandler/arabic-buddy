-- What a curriculum rating was asked as (quiz Phase 8).
--
-- The quiz ladder's thresholds (src/lib/quizLadder.ts, LADDER_THRESHOLDS) are a
-- first guess, to be set from real ratings once the quiz has a month of them.
-- review_log already holds each rating with the memory state either side of it,
-- but not what the learner was asked: a gap, a picture, the word heard alone.
-- Without that, a report cannot tell one question's accuracy from another's,
-- nor a boss (asked a first look whatever its stability) from the ladder's own
-- question.
--
-- The rating write carries it (src/lib/quizRatingFields.ts): two columns on
-- word_reviews, set with every rating, nulls for a flip card, since the row
-- keeps its last values and a flip rating after a quiz one would otherwise be
-- logged as the quiz question. The log trigger copies them beside the rating,
-- so the log stays trigger-written: a learner can no more author this than the
-- rating itself.
--
-- Merged through GitHub, this is not on the live project until the owner
-- applies it (quiz Phase 8b). Until then the client's write is refused for the
-- new columns and sent again without them, so ratings save exactly as before
-- and the log carries no format.

ALTER TABLE public.word_reviews
  ADD COLUMN IF NOT EXISTS last_quiz_format text,
  ADD COLUMN IF NOT EXISTS last_quiz_step smallint;

ALTER TABLE public.review_log
  ADD COLUMN IF NOT EXISTS quiz_format text,
  ADD COLUMN IF NOT EXISTS quiz_step smallint;

-- The trigger from 20260902000000_review_log, with the two fields copied in.
-- Everything else is as it was.
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
      elapsed_days, scheduled_days, repetitions_after, reviewed_at,
      quiz_format, quiz_step
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
      NEW.last_reviewed_at,
      NEW.last_quiz_format,
      NEW.last_quiz_step
    );
  END IF;

  -- Production. Never created cold (useReview refuses), so only UPDATE can
  -- change its last_reviewed_at; guarded the same way regardless.
  IF NEW.production_last_reviewed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.production_last_reviewed_at IS DISTINCT FROM OLD.production_last_reviewed_at) THEN
    INSERT INTO public.review_log (
      user_id, deck, card_id, item_id, direction, rating,
      stability_before, stability_after, difficulty_before, difficulty_after,
      elapsed_days, scheduled_days, repetitions_after, reviewed_at,
      quiz_format, quiz_step
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
      NEW.production_last_reviewed_at,
      NEW.last_quiz_format,
      NEW.last_quiz_step
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.log_word_review() FROM public;
