CREATE OR REPLACE FUNCTION public.is_public_profile(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.user_id = _user_id
      AND profiles.show_on_leaderboard = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_public_profile(uuid) TO authenticated, anon;

DROP POLICY IF EXISTS "Anyone can view public XP for leaderboard" ON public.user_xp;
CREATE POLICY "Anyone can view public XP for leaderboard" ON public.user_xp
FOR SELECT USING (
  public.is_public_profile(user_xp.user_id) OR auth.uid() = user_id
);

DROP POLICY IF EXISTS "Anyone can view public streaks for leaderboard" ON public.review_streaks;
CREATE POLICY "Anyone can view public streaks for leaderboard"
  ON public.review_streaks FOR SELECT TO authenticated
  USING (public.is_public_profile(review_streaks.user_id));

DROP POLICY IF EXISTS "Users can view follows involving them or public profiles" ON public.user_follows;
CREATE POLICY "Users can view follows involving them or public profiles"
ON public.user_follows FOR SELECT
USING (
  auth.uid() = follower_id
  OR auth.uid() = following_id
  OR public.is_public_profile(following_id)
);