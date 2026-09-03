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

-- set_phrase_occasions
DROP POLICY IF EXISTS "Anyone can view published occasions" ON public.set_phrase_occasions;
DROP POLICY IF EXISTS "Admins manage occasions" ON public.set_phrase_occasions;

CREATE POLICY "Anyone can view published occasions"
  ON public.set_phrase_occasions FOR SELECT
  USING (status = 'published' OR public.can_manage_content());

CREATE POLICY "Content managers manage occasions"
  ON public.set_phrase_occasions FOR ALL TO authenticated
  USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());

-- set_phrases
DROP POLICY IF EXISTS "Anyone can view published phrases" ON public.set_phrases;
DROP POLICY IF EXISTS "Admins manage phrases" ON public.set_phrases;

CREATE POLICY "Anyone can view published phrases"
  ON public.set_phrases FOR SELECT
  USING (status = 'published' OR public.can_manage_content());

CREATE POLICY "Content managers manage phrases"
  ON public.set_phrases FOR ALL TO authenticated
  USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());

-- dialect_rules delete
DROP POLICY IF EXISTS "Admins can delete rules" ON public.dialect_rules;

CREATE POLICY "Content managers can delete rules"
  ON public.dialect_rules FOR DELETE TO authenticated
  USING (public.can_manage_content());

-- dialect_rule_violations
DROP POLICY IF EXISTS "Admins manage violations" ON public.dialect_rule_violations;

CREATE POLICY "Content managers manage violations"
  ON public.dialect_rule_violations FOR ALL TO authenticated
  USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20260903090000','review_streaks_friend_visibility'),
  ('20260903100000','reviewer_content_writes')
ON CONFLICT DO NOTHING;