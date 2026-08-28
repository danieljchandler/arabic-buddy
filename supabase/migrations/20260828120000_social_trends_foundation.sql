-- Social trends foundation (trending topics + harvested social posts).
--
-- "What is the Arab world posting right now?" as authentic dialect input.
-- Three free sources, none of which is the paid X API:
--
--   x         per-country trending *topics* scraped from public trend
--             aggregators (getdaytrends.com) via Jina Reader — the same
--             fetch path scrape-x-post already uses. Topics only: X search
--             requires login, so post bodies are out of reach for free.
--   reddit    top posts of country subreddits via Reddit's OAuth API
--             (a free registered app), kept only when they contain Arabic.
--   telegram  public channel previews (t.me/s/<handle>) — no API key at
--             all, and the richest free source for Yemeni content.
--
-- Three tables:
--
--   social_content_sources  the curated source registry (which subreddits,
--                           which channels, which trend-country slugs),
--                           mirroring content_channels: per-dialect, with a
--                           candidate -> approved -> rejected lifecycle and
--                           VERIFY: notes for unvetted seeds
--   trending_topics         one row per (country, topic, day) — the trend
--                           chips on /trending, linking out to X search
--   social_posts            harvested post bodies. Every row passes an
--                           askBrain screen before learners see it, because
--                           trending/news content skews MSA — the exact
--                           register this app promises never to teach.
--                           Screening happens in harvest-social-trends;
--                           only status='approved' rows are learner-visible.
--
-- Access model is the repo's asymmetric read/write pattern: learners (and
-- anonymous visitors — /trending is public like /discover) read topics and
-- approved posts; every write goes through the harvest edge function under
-- the service role, so nobody can plant themselves a "trending" post. The
-- source registry is content-manager + service-role territory only.

-- ---------- social_content_sources ----------

CREATE TABLE IF NOT EXISTS public.social_content_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('x', 'reddit', 'telegram')),
  -- What the harvester actually fetches: a getdaytrends country slug
  -- ('saudi-arabia'), a subreddit name ('Kuwait'), or a t.me channel
  -- handle ('yemennownews').
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

-- ---------- trending_topics ----------

CREATE TABLE IF NOT EXISTS public.trending_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL DEFAULT 'x' CHECK (platform IN ('x')),
  country text NOT NULL,
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  topic text NOT NULL,
  rank integer,
  -- Where a learner can see the topic in the wild (an X search URL). The
  -- app links out rather than embedding, which keeps us inside X's terms.
  source_url text,
  captured_on date NOT NULL DEFAULT CURRENT_DATE,
  captured_at timestamptz NOT NULL DEFAULT now(),
  -- One row per topic per country per day; re-harvesting the same day
  -- refreshes rank instead of stacking duplicates.
  UNIQUE (country, topic, captured_on)
);

CREATE INDEX idx_trending_topics_day
  ON public.trending_topics (captured_on DESC, country, rank);

ALTER TABLE public.trending_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trending_topics_read" ON public.trending_topics
  FOR SELECT USING (true);
GRANT SELECT ON public.trending_topics TO anon, authenticated;
GRANT ALL ON public.trending_topics TO service_role;

-- ---------- social_posts ----------

CREATE TABLE IF NOT EXISTS public.social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.social_content_sources(id) ON DELETE SET NULL,
  platform text NOT NULL CHECK (platform IN ('x', 'reddit', 'telegram')),
  -- The platform's own id ('yemennownews/1234', 't3_abc123'), so a re-run
  -- upserts instead of duplicating.
  external_id text NOT NULL,
  url text,
  author text,
  dialect text NOT NULL DEFAULT 'Gulf',
  country text,
  -- The trend/topic that surfaced it, when there is one.
  topic text,
  arabic_text text NOT NULL,
  -- English gloss produced by the same screening call — one model call per
  -- post covers both the verdict and the translation.
  translation text,
  -- Platform-shaped counters ({"views": 14700} / {"ups": 120, "comments": 34}).
  -- Free-form jsonb because three platforms measure popularity three ways.
  engagement jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The full screening verdict (variety, confidence, reason), kept so the
  -- threshold can be re-tuned over history and rejects can be audited.
  screen jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  posted_at timestamptz,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)
);

-- The feed reads newest approved first; the harvester reads pending oldest
-- first. One index serves both ends.
CREATE INDEX idx_social_posts_status_recent
  ON public.social_posts (status, captured_at DESC);

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_posts_read" ON public.social_posts
  FOR SELECT USING (status = 'approved' OR public.can_manage_content());
GRANT SELECT ON public.social_posts TO anon, authenticated;
GRANT ALL ON public.social_posts TO service_role;
