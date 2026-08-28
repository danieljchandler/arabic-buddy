CREATE TABLE IF NOT EXISTS public.social_content_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('x', 'reddit', 'telegram')),
  handle text NOT NULL,
  display_name text NOT NULL,
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  country text,
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'approved', 'rejected')),
  notes text,
  last_harvested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, handle)
);

ALTER TABLE public.social_content_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_content_sources_manage" ON public.social_content_sources
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT ALL ON public.social_content_sources TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_content_sources TO authenticated;

CREATE TABLE IF NOT EXISTS public.trending_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL DEFAULT 'x' CHECK (platform IN ('x')),
  country text NOT NULL,
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  topic text NOT NULL,
  rank integer,
  source_url text,
  captured_on date NOT NULL DEFAULT CURRENT_DATE,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country, topic, captured_on)
);

CREATE INDEX IF NOT EXISTS idx_trending_topics_day
  ON public.trending_topics (captured_on DESC, country, rank);

ALTER TABLE public.trending_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trending_topics_read" ON public.trending_topics
  FOR SELECT USING (true);
GRANT SELECT ON public.trending_topics TO anon, authenticated;
GRANT ALL ON public.trending_topics TO service_role;

CREATE TABLE IF NOT EXISTS public.social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.social_content_sources(id) ON DELETE SET NULL,
  platform text NOT NULL CHECK (platform IN ('x', 'reddit', 'telegram')),
  external_id text NOT NULL,
  url text,
  author text,
  dialect text NOT NULL DEFAULT 'Gulf',
  country text,
  topic text,
  arabic_text text NOT NULL,
  translation text,
  engagement jsonb NOT NULL DEFAULT '{}'::jsonb,
  screen jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  posted_at timestamptz,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_social_posts_status_recent
  ON public.social_posts (status, captured_at DESC);

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_posts_read" ON public.social_posts
  FOR SELECT USING (status = 'approved' OR public.can_manage_content());
GRANT SELECT ON public.social_posts TO anon, authenticated;
GRANT ALL ON public.social_posts TO service_role;

INSERT INTO public.social_content_sources
  (platform, handle, display_name, dialect, country, status, notes) VALUES
  ('x', 'saudi-arabia', 'Saudi Arabia trends', 'Gulf', 'Saudi Arabia', 'approved',
   'Verified 2026-08-28: trend table parses via Jina.'),
  ('x', 'kuwait', 'Kuwait trends', 'Gulf', 'Kuwait', 'approved', NULL),
  ('x', 'united-arab-emirates', 'UAE trends', 'Gulf', 'UAE', 'approved', NULL),
  ('x', 'qatar', 'Qatar trends', 'Gulf', 'Qatar', 'approved', NULL),
  ('x', 'bahrain', 'Bahrain trends', 'Gulf', 'Bahrain', 'approved', NULL),
  ('x', 'oman', 'Oman trends', 'Gulf', 'Oman', 'approved', NULL),
  ('x', 'egypt', 'Egypt trends', 'Egyptian', 'Egypt', 'approved', NULL),
  ('reddit', 'saudiarabia', 'r/saudiarabia', 'Gulf', 'Saudi Arabia', 'approved',
   'Mostly English threads; the Arabic-script filter keeps only Arabic posts.'),
  ('reddit', 'Kuwait', 'r/Kuwait', 'Gulf', 'Kuwait', 'approved', NULL),
  ('reddit', 'UAE', 'r/UAE', 'Gulf', 'UAE', 'approved', NULL),
  ('reddit', 'qatar', 'r/qatar', 'Gulf', 'Qatar', 'candidate',
   'VERIFY: activity level; may be dominated by expat English.'),
  ('reddit', 'Bahrain', 'r/Bahrain', 'Gulf', 'Bahrain', 'candidate',
   'VERIFY: low volume.'),
  ('reddit', 'Oman', 'r/Oman', 'Gulf', 'Oman', 'candidate',
   'VERIFY: low volume.'),
  ('reddit', 'Egypt', 'r/Egypt', 'Egyptian', 'Egypt', 'approved', NULL),
  ('reddit', 'Yemen', 'r/Yemen', 'Yemeni', 'Yemen', 'approved',
   'Small but one of the few open Yemeni forums; every Arabic post counts.'),
  ('telegram', 'kuwaitnews', 'Kuwait News | كويت نيوز', 'Gulf', 'Kuwait', 'approved',
   'Verified 2026-08-28: preview enabled, 20 messages parsed.'),
  ('telegram', 'emaratalyoum', 'Emarat Al Youm | الإمارات اليوم', 'Gulf', 'UAE', 'approved',
   'Verified 2026-08-28: preview enabled.'),
  ('telegram', 'alarabiya', 'Al Arabiya | العربية', 'Gulf', 'Saudi Arabia', 'candidate',
   'Preview verified but pan-Arab MSA news — expect the screen to reject most of it. Kept as a volume fallback.'),
  ('telegram', 'rassdnewsn', 'Rassd | رصد', 'Egyptian', 'Egypt', 'approved',
   'Verified 2026-08-28: preview enabled, 20 messages parsed.'),
  ('telegram', 'akhbarelyomgate', 'Akhbar El Yom | أخبار اليوم', 'Egyptian', 'Egypt', 'approved',
   'Verified 2026-08-28: preview enabled.'),
  ('telegram', 'cairo24', 'Cairo 24 | القاهرة 24', 'Egyptian', 'Egypt', 'candidate',
   'Preview enabled but sparse (5 messages on verify). Watch a few harvests.'),
  ('telegram', 'yemennownews', 'Yemen Now | اليمن الآن', 'Yemeni', 'Yemen', 'approved',
   'Verified 2026-08-28: preview enabled, 20 messages parsed. Primary Yemeni source.')
ON CONFLICT (platform, handle) DO NOTHING;