-- Social trends: a human approves, the AI only triages.
--
-- The first cut let the askBrain screen publish directly: a passing verdict
-- set status='approved' and the post was live. Two problems surfaced in the
-- first real harvests. Editorially, "the model liked it" is not the bar for
-- content that represents the app's dialect promise. Practically, the screen
-- had to be strict to be trusted as a publisher, and strict screening starved
-- Gulf — its sources are news channels writing MSA, so nearly everything was
-- rejected outright and a reviewer never even saw the borderline cases.
--
-- New lifecycle:
--
--   pending    harvested, not yet screened
--   screened   passed AI triage; waiting for a human on /admin/social-trends
--   approved   a content manager said yes — the only learner-eligible state
--   rejected   failed triage (MSA / not Arabic) or a human said no
--
-- With a human deciding, triage can afford to be generous: "mixed" and
-- low-confidence dialect calls go to the review queue instead of the bin.
-- The whole feature also moves admin-side — reads now require
-- can_manage_content(), so nothing here is visible to learners at all until
-- a learner surface is deliberately reintroduced.

-- ---------- status: add 'screened' ----------

ALTER TABLE public.social_posts DROP CONSTRAINT social_posts_status_check;
ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_status_check
  CHECK (status IN ('pending', 'screened', 'approved', 'rejected'));

-- Rows the AI alone approved were never seen by a person; put them in the
-- review queue rather than leaving them grandfathered as published.
UPDATE public.social_posts SET status = 'screened' WHERE status = 'approved';

-- ---------- writes: content managers judge through RLS ----------

CREATE POLICY "social_posts_manage" ON public.social_posts
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_posts TO authenticated;

-- ---------- reads: admin-side only ----------

DROP POLICY "social_posts_read" ON public.social_posts;
CREATE POLICY "social_posts_read" ON public.social_posts
  FOR SELECT USING (public.can_manage_content());
REVOKE SELECT ON public.social_posts FROM anon;

DROP POLICY "trending_topics_read" ON public.trending_topics;
CREATE POLICY "trending_topics_read" ON public.trending_topics
  FOR SELECT USING (public.can_manage_content());
REVOKE SELECT ON public.trending_topics FROM anon;

-- ---------- more Gulf/Yemeni sources (verified 2026-08-28) ----------
-- The Gulf drought was partly a source problem: two news channels for the
-- whole Gulf. These previews were fetched and parsed live before seeding.

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
