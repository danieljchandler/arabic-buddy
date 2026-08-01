-- Harden user_concept_mastery ahead of anything actually writing to it.
--
-- The table was created by 20260503134531 and, until the concept-mastery
-- modules added alongside this migration, no code path ever inserted a row —
-- so these problems were latent. They stop being latent now.
--
-- Written as a forward migration rather than an edit to the original, because
-- Supabase records applied migrations by version timestamp in
-- supabase_migrations.schema_migrations and never re-runs a version it has
-- already seen: editing 20260503134531 in place would be a no-op on every
-- database that already has it.
--
-- Four fixes:
--   1. user_id was a bare uuid with no reference to auth.users, so deleting an
--      account left mastery rows orphaned. Same defect as the three tables
--      fixed in 20260726140000.
--   2. The UPDATE policy had USING but no WITH CHECK, so a learner could pass
--      the row-visibility test on their own row and then rewrite user_id to
--      someone else's — silently reassigning their mastery. USING guards which
--      rows you may touch; only WITH CHECK guards what you may turn them into.
--   3. Policies called auth.uid() unwrapped, which Postgres re-evaluates once
--      per row rather than once per query (Supabase's auth_rls_initplan
--      advisory). The learner-facing grammar view reads every mastery row a
--      user has, so this is the read path that most wants the initplan.
--   4. No explicit grants. Supabase's defaults happen to cover this today;
--      stating it means the table doesn't depend on that staying true.

-- ── 1. Cascade on account deletion ───────────────────────────────────────────
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, hence the catalog check.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.user_concept_mastery'::regclass
      AND conname = 'user_concept_mastery_user_id_fkey'
  ) THEN
    ALTER TABLE public.user_concept_mastery
      ADD CONSTRAINT user_concept_mastery_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 2 & 3. Rewrite the owner policies ────────────────────────────────────────
-- DROP ... IF EXISTS then CREATE, so this is safe to re-run.

DROP POLICY IF EXISTS "Users read own mastery" ON public.user_concept_mastery;
CREATE POLICY "Users read own mastery"
  ON public.user_concept_mastery
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users insert own mastery" ON public.user_concept_mastery;
CREATE POLICY "Users insert own mastery"
  ON public.user_concept_mastery
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users update own mastery" ON public.user_concept_mastery;
CREATE POLICY "Users update own mastery"
  ON public.user_concept_mastery
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins read all mastery" ON public.user_concept_mastery;
CREATE POLICY "Admins read all mastery"
  ON public.user_concept_mastery
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ── 4. Explicit grants ───────────────────────────────────────────────────────
-- Writes all go through the service role in the edge function, which bypasses
-- RLS; the client only ever reads. Granting exactly that keeps the two paths
-- from drifting into "the client can write its own mastery scores".

GRANT SELECT ON public.user_concept_mastery TO authenticated;
GRANT SELECT ON public.curriculum_concepts TO authenticated;

-- No new index: the learner-facing read filters on user_id, and the primary key
-- (user_id, concept_id) already provides a btree with user_id leading.
