-- Friends' streaks were always 0: useFriendsActivity selects review_streaks
-- for followed users, but the only SELECT policy was "own rows", and
-- PostgREST answers a refused row with silence rather than an error. Mirror
-- the user_xp leaderboard rule so a streak is visible exactly when the XP
-- beside it is.
--
-- review_streaks is created outside this migration history (see
-- KNOWN_MISSING_TABLES in src/test/migrationReplay.test.ts), so guard the
-- policy for a from-scratch replay; on the real database it applies.
DO $$
BEGIN
  IF to_regclass('public.review_streaks') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can view public streaks for leaderboard" ON public.review_streaks';
    EXECUTE $p$
      CREATE POLICY "Anyone can view public streaks for leaderboard"
        ON public.review_streaks FOR SELECT TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.user_id = review_streaks.user_id
              AND profiles.show_on_leaderboard = true
          )
          OR auth.uid() = user_id
        )
    $p$;
  END IF;
END
$$;
