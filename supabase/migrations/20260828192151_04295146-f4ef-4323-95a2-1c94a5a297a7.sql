-- Re-application of 20260828150000_social_posts_human_approval.sql, plus the
-- first batch of verified Telegram sources.
--
-- The statements above the INSERT are a verbatim repeat of that earlier
-- migration, so on a database that already has it they are all no-ops — but
-- only if they are written as no-ops. As first authored they were not: a bare
-- `CREATE POLICY "social_posts_manage"` over an existing policy aborts, which
-- is what stopped the whole migration set replaying from scratch. Every
-- statement here is now idempotent, which is what a re-application has to be.

ALTER TABLE public.social_posts DROP CONSTRAINT IF EXISTS social_posts_status_check;
ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_status_check
  CHECK (status IN ('pending', 'screened', 'approved', 'rejected'));
UPDATE public.social_posts SET status = 'screened' WHERE status = 'approved';

DROP POLICY IF EXISTS "social_posts_manage" ON public.social_posts;
CREATE POLICY "social_posts_manage" ON public.social_posts
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_posts TO authenticated;

DROP POLICY IF EXISTS "social_posts_read" ON public.social_posts;
CREATE POLICY "social_posts_read" ON public.social_posts
  FOR SELECT USING (public.can_manage_content());
REVOKE SELECT ON public.social_posts FROM anon;

DROP POLICY IF EXISTS "trending_topics_read" ON public.trending_topics;
CREATE POLICY "trending_topics_read" ON public.trending_topics
  FOR SELECT USING (public.can_manage_content());
REVOKE SELECT ON public.trending_topics FROM anon;

INSERT INTO public.social_content_sources
  (platform, handle, display_name, dialect, country, status, notes) VALUES
  ('telegram', 'saudinews50', 'Saudi News | أخبار السعودية', 'Gulf', 'Saudi Arabia', 'approved',
   'Verified 2026-08-28: preview enabled, 20 messages parsed. Highest-volume Saudi channel.'),
  ('telegram', 'thmanyah', 'Thmanyah | ثمانية', 'Gulf', 'Saudi Arabia', 'approved',
   'Verified 2026-08-28: preview enabled. Podcast/media company — less news-register than the news channels.'),
  ('telegram', 'alraimedia', 'Al Rai | الراي', 'Gulf', 'Kuwait', 'approved',
   'Verified 2026-08-28: preview enabled, 20 messages parsed.'),
  ('telegram', 'AjmanNews', 'Ajman News | أخبار عجمان', 'Gulf', 'UAE', 'approved',
   'Verified 2026-08-28: preview enabled, 20 messages parsed.'),
  ('telegram', 'yemeneco', 'Yemen Economy | اقتصاد اليمن', 'Yemeni', 'Yemen', 'approved',
   'Verified 2026-08-28: preview enabled, 20 messages parsed.')
ON CONFLICT (platform, handle) DO NOTHING;