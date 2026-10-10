-- Ladder climbs on the leaderboard (quiz Phase 7.4).
--
-- The weekly board ranks by XP. Beside it, each learner's climbs this week:
-- how many times one of their words moved up a step of the quiz ladder
-- (src/lib/quizLadder.ts), the one figure in the game that means something in
-- spaced-repetition terms.
--
-- Counted here, from review_log, rather than posted by the client. review_log
-- is written only by triggers on the schedule tables
-- (20260902000000_review_log), so a climb is counted from a schedule write, not
-- from a counter the client bumps. That is not proof against a determined
-- learner: they may write their own word_reviews rows through the API, as
-- they may call award_xp. So the count bounds what such writes can buy: only
-- this week's reviews (never one stamped in the future), only a Hard, Good or
-- Easy, and at most one climb per card, direction and day.
--
-- It counts what review_log logs: the curriculum deck's words (deck = 'word'),
-- in either review style, since the ladder's step is a function of a card's
-- memory and not of how it was asked. My Words and My Phrases are not logged,
-- so not counted; logging them is its own migration.
--
-- Merged through GitHub, this is not on the live project until the owner
-- applies it (quiz Phase 7b). Until then the RPC is missing and the board shows
-- XP alone, as before.

-- The ladder's step for a memory state: rungForMemory in src/lib/quizLadder.ts,
-- with LADDER_THRESHOLDS written out. src/test/leaderboardClimbs.test.ts holds
-- the numbers to the TypeScript, and migrationReplay.test.ts compares the two
-- on a grid of memory states against Postgres. A stability that is missing or
-- not finite reads as none, as Number.isFinite makes it there. A plain SQL
-- expression with no SET clause, so the planner inlines it into the count.
CREATE OR REPLACE FUNCTION public.quiz_ladder_step(_stability numeric, _repetitions integer, _direction text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _stability IS NULL OR _stability IN ('NaN', 'Infinity', '-Infinity') THEN
      CASE WHEN _direction = 'production' THEN 7 ELSE 1 END
    WHEN _direction = 'production' THEN
      CASE
        WHEN _stability >= 60 THEN 10
        WHEN _stability >= 30 THEN 9
        WHEN _stability >= 14 THEN 8
        ELSE 7
      END
    WHEN COALESCE(_repetitions, 0) <= 0 OR _stability < 1 THEN 1
    WHEN _stability < 4 THEN 2
    WHEN _stability < 8 THEN 3
    WHEN _stability < 16 THEN 4
    WHEN _stability < 30 THEN 5
    ELSE 6
  END
$$;

GRANT EXECUTE ON FUNCTION public.quiz_ladder_step(numeric, integer, text) TO authenticated, anon;

-- Climbs this week for the learners asked about who are on the board. The week
-- is Monday 00:00 UTC to the next, the week weekly_goals counts XP in.
--
-- A review climbs when the step its memory lands on is above the step it was
-- asked at. The step before needs the repetitions before, which the log does
-- not keep; calculateNextReview (src/lib/spacedRepetition.ts) adds one on every
-- review but a lapse and a learning card's Hard, which stays at 0, so it is
-- repetitions_after - 1, never below 0. Only a Hard, Good or Easy is counted:
-- a lapse only lowers a card, and a row with no rating (logged before the app
-- recorded one) says too little. A first review (stability_before is NULL) was
-- asked as a new card: a first look, or "say it" on the production side.
--
-- SECURITY DEFINER so it can read other learners' review_log rows, which RLS
-- otherwise keeps to their owner; it returns nothing but a count, and only for
-- learners who chose to be on the board (profiles.show_on_leaderboard, the
-- rule leaderboard_profiles serves). At most 100 learners a call, as a board
-- page shows.
CREATE OR REPLACE FUNCTION public.leaderboard_climbs(_user_ids uuid[])
RETURNS TABLE (user_id uuid, climbs_this_week integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _week_start timestamptz := date_trunc('week', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc';
BEGIN
  IF _user_ids IS NULL OR cardinality(_user_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(_user_ids) > 100 THEN
    RAISE EXCEPTION 'At most 100 learners a call';
  END IF;

  RETURN QUERY
  SELECT p.user_id,
         COUNT(DISTINCT (r.card_id, r.direction, (r.reviewed_at AT TIME ZONE 'utc')::date)) FILTER (
           WHERE r.rating IN ('hard', 'good', 'easy')
             AND public.quiz_ladder_step(r.stability_after, r.repetitions_after, r.direction)
               > public.quiz_ladder_step(
                   r.stability_before,
                   CASE WHEN r.stability_before IS NULL THEN 0
                        ELSE GREATEST(COALESCE(r.repetitions_after, 0) - 1, 0) END,
                   r.direction)
         )::integer
  FROM public.profiles p
  LEFT JOIN public.review_log r
    ON r.user_id = p.user_id
   AND r.deck = 'word'
   AND r.reviewed_at >= _week_start
   AND r.reviewed_at < LEAST(_week_start + interval '7 days', now() + interval '1 minute')
  WHERE p.user_id = ANY (_user_ids)
    AND p.show_on_leaderboard = true
  GROUP BY p.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.leaderboard_climbs(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.leaderboard_climbs(uuid[]) TO authenticated, anon;
