DROP POLICY IF EXISTS "Users insert own mastery" ON public.user_concept_mastery;
DROP POLICY IF EXISTS "Users update own mastery" ON public.user_concept_mastery;

REVOKE INSERT, UPDATE, DELETE ON public.user_concept_mastery FROM anon, authenticated;
GRANT SELECT ON public.user_concept_mastery TO authenticated;
GRANT ALL ON public.user_concept_mastery TO service_role;