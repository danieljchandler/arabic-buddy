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
-- The rating's write carries it (src/lib/quizRatingFields.ts): three columns on
-- word_reviews, the format, the step and the moment of the rating it belongs
-- to. The log trigger copies the format and step beside the rating only when
-- that moment is the review's own (last_quiz_at equals the direction's new
-- last_reviewed_at): a write that changes last_reviewed_at without them (an
-- older tab, a device that has stopped sending them, any future writer) is
-- logged with none, never with the previous rating's question. And only what
-- the app could have asked: a format of lowercase words, a step from 1 to 10.
-- The row is the learner's own, so what is written there is theirs to write;
-- the log, which a report reads across learners, keeps nothing else. So the
-- log stays trigger-written: a learner can no more author it than the rating.
--
-- The log also gains repetitions_before. The report needs the memory a card
-- was asked from, and repetitions_after - 1 is wrong for a lapse, which leaves
-- repetitions as they were; OLD has the number.
--
-- Merged through GitHub, this is not on the live project until the owner
-- applies it (quiz Phase 8b). Until then the client's write is refused for the
-- new columns and sent again without them, so ratings save exactly as before
-- and the log carries no question.

ALTER TABLE public.word_reviews
  ADD COLUMN IF NOT EXISTS last_quiz_format text,
  ADD COLUMN IF NOT EXISTS last_quiz_step smallint,
  ADD COLUMN IF NOT EXISTS last_quiz_at timestamptz;

ALTER TABLE public.review_log
  ADD COLUMN IF NOT EXISTS quiz_format text,
  ADD COLUMN IF NOT EXISTS quiz_step smallint,
  ADD COLUMN IF NOT EXISTS repetitions_before integer;

-- The trigger from 20260902000000_review_log, with the question and the
-- repetitions before copied in. Everything else is as it was.
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
      quiz_format, quiz_step, repetitions_before
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
      CASE WHEN NEW.last_quiz_at IS NOT DISTINCT FROM NEW.last_reviewed_at
                AND NEW.last_quiz_format ~ '^[a-z]+(-[a-z]+)*$' AND length(NEW.last_quiz_format) <= 32
           THEN NEW.last_quiz_format END,
      CASE WHEN NEW.last_quiz_at IS NOT DISTINCT FROM NEW.last_reviewed_at
                AND NEW.last_quiz_step BETWEEN 1 AND 10
           THEN NEW.last_quiz_step END,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.repetitions END
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
      quiz_format, quiz_step, repetitions_before
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
      CASE WHEN NEW.last_quiz_at IS NOT DISTINCT FROM NEW.production_last_reviewed_at
                AND NEW.last_quiz_format ~ '^[a-z]+(-[a-z]+)*$' AND length(NEW.last_quiz_format) <= 32
           THEN NEW.last_quiz_format END,
      CASE WHEN NEW.last_quiz_at IS NOT DISTINCT FROM NEW.production_last_reviewed_at
                AND NEW.last_quiz_step BETWEEN 1 AND 10
           THEN NEW.last_quiz_step END,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.production_repetitions END
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.log_word_review() FROM public;
