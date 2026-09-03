-- Content reviewers work /admin/set-phrases, /admin/chunks and
-- /admin/dialect-rules — src/lib/rbac.ts allow-lists all three for the role —
-- but the policies behind those pages were still admin-only. A reviewer could
-- open the queue and see nothing but published phrases, and every approve,
-- edit, promote, delete and resolve matched zero rows under RLS while the page
-- toasted "Saved". Bring the four tables in line with dialect_rules' own
-- SELECT/INSERT/UPDATE policies (20260706075500), which already use
-- public.can_manage_content() — is_admin() OR is_content_reviewer().

-- set_phrase_occasions: drafts visible to, and writable by, content managers.
DROP POLICY IF EXISTS "Anyone can view published occasions" ON public.set_phrase_occasions;
DROP POLICY IF EXISTS "Admins manage occasions" ON public.set_phrase_occasions;

CREATE POLICY "Anyone can view published occasions"
  ON public.set_phrase_occasions FOR SELECT
  USING (status = 'published' OR public.can_manage_content());

CREATE POLICY "Content managers manage occasions"
  ON public.set_phrase_occasions FOR ALL TO authenticated
  USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());

-- set_phrases: same shape.
DROP POLICY IF EXISTS "Anyone can view published phrases" ON public.set_phrases;
DROP POLICY IF EXISTS "Admins manage phrases" ON public.set_phrases;

CREATE POLICY "Anyone can view published phrases"
  ON public.set_phrases FOR SELECT
  USING (status = 'published' OR public.can_manage_content());

CREATE POLICY "Content managers manage phrases"
  ON public.set_phrases FOR ALL TO authenticated
  USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());

-- dialect_rules: 20260706075500 redefined SELECT/INSERT/UPDATE for content
-- managers and left DELETE on is_admin(), so a reviewer's delete silently
-- removed nothing.
DROP POLICY IF EXISTS "Admins can delete rules" ON public.dialect_rules;

CREATE POLICY "Content managers can delete rules"
  ON public.dialect_rules FOR DELETE TO authenticated
  USING (public.can_manage_content());

-- dialect_rule_violations: the Violations tab's Resolve button is an UPDATE.
DROP POLICY IF EXISTS "Admins manage violations" ON public.dialect_rule_violations;

CREATE POLICY "Content managers manage violations"
  ON public.dialect_rule_violations FOR ALL TO authenticated
  USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
