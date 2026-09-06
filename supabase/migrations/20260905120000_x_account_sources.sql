-- X becomes a content source, not just a trend chip.
--
-- The social harvester shipped on the premise that X post bodies are out of
-- reach for free: search needs a login, and X moved to pay-per-use with no
-- free tier in February 2026. So platform 'x' meant *trending topics* — a
-- chip that links out — and every word of actual Arabic in the pipeline came
-- from Telegram news channels. That is the complaint this migration answers:
-- the feed is Telegram, and Telegram is a newsroom.
--
-- X's embed backend turns out to be public and unauthenticated, because
-- embedded tweets have to render for logged-out readers:
--
--   syndication.twitter.com/srv/timeline-profile/screen-name/<handle>
--   cdn.syndication.twimg.com/tweet-result?id=<id>&token=<derived>
--
-- Per-account timelines and per-id hydration, free, no key. There is still no
-- free search (timeline-search/-hashtag/-conversation all 404), so the scarce
-- resource is knowing *which accounts* to read — a research problem, not an
-- API one. See docs/x-content-pipeline.md for the discovery loop that fills
-- the registry, and _shared/xSyndication.ts for the fetch/parse contract.
--
-- Three changes here:
--
--   1. 'x' now means an X *account handle*. The country trend slugs move to
--      their own platform, 'x_trends', so one platform key stops meaning two
--      unrelated things.
--   2. Sources carry the evidence of their last verification, so "why is this
--      approved" is answerable without re-fetching.
--   3. A seed of X accounts, split honestly by what was actually fetched.

-- ---------- 1. split 'x' into accounts and trend countries ----------

ALTER TABLE public.social_content_sources
  DROP CONSTRAINT social_content_sources_platform_check;

-- Existing 'x' rows are getdaytrends country slugs ('saudi-arabia', 'egypt'),
-- never handles. Move them before the new constraint makes 'x' mean handle.
UPDATE public.social_content_sources
   SET platform = 'x_trends'
 WHERE platform = 'x';

ALTER TABLE public.social_content_sources
  ADD CONSTRAINT social_content_sources_platform_check
  CHECK (platform IN ('x', 'x_trends', 'reddit', 'telegram'));

-- ---------- 2. verification evidence ----------

ALTER TABLE public.social_content_sources
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  -- What the last probe saw: tweets returned, how many were Arabic, how much
  -- of it survives the marker prefilter, how old the newest post was. A
  -- reviewer approving a handle is approving this, and a source that quietly
  -- stops returning anything shows up as a stale probe rather than as silence.
  ADD COLUMN IF NOT EXISTS verification jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------- 3. seed X accounts ----------
--
-- Every row below was fetched live through the syndication path on 2026-09-05
-- and its timeline parsed; `notes` records what came back. Guessing handles
-- has a poor hit rate — well over half of a plausible-looking list returned an
-- empty timeline — which is exactly why the discovery loop exists and why
-- nothing is approved here on a hunch.
--
-- The split that matters is not country, it is *who is writing*. A newspaper
-- account writes wire copy in فصحى; a singer writing to their followers writes
-- the language this app teaches. Personality accounts are approved; news
-- accounts are seeded as candidates and labelled as volume fallback, because
-- seeding a wall of newsrooms is how the Telegram side ended up where it is.

INSERT INTO public.social_content_sources
  (platform, handle, display_name, dialect, country, status, notes) VALUES

  -- Egyptian: people writing to their own followers.
  ('x', 'tamerhosny', 'Tamer Hosny | تامر حسني', 'Egyptian', 'Egypt', 'approved',
   'Verified 2026-09-05: 99 tweets parsed, 93 Arabic. Writes to fans in Egyptian, not press-release Arabic.'),
  ('x', 'amrdiab', 'Amr Diab | عمرو دياب', 'Egyptian', 'Egypt', 'approved',
   'Verified 2026-09-05: 98 tweets parsed, 74 Arabic. Mix of promo and personal; the personal half is dialect.'),
  ('x', 'Mohamed_Ramadan', 'Mohamed Ramadan | محمد رمضان', 'Egyptian', 'Egypt', 'approved',
   'Verified 2026-09-05: 94 tweets parsed, 63 Arabic. High-engagement personal posting.'),
  ('x', 'AlAhly', 'Al Ahly SC | الأهلي', 'Egyptian', 'Egypt', 'approved',
   'Verified 2026-09-05: 99 tweets parsed, 91 Arabic. Club voice — semi-formal, but football register, not wire copy.'),

  -- Egyptian news: volume fallback, expect the prefilter to bin most of it.
  ('x', 'almasryalyoum', 'Al Masry Al Youm | المصري اليوم', 'Egyptian', 'Egypt', 'candidate',
   'Verified 2026-09-05: 99 tweets parsed, all Arabic, but newsroom register. Kept as volume fallback; the quoted speech inside headlines is the dialect worth mining.'),
  ('x', 'youm7', 'Youm7 | اليوم السابع', 'Egyptian', 'Egypt', 'candidate',
   'Verified 2026-09-05: 98 tweets parsed, 97 Arabic. Newsroom register — volume fallback.'),
  ('x', 'ELWATANNEWS', 'Al Watan | الوطن', 'Egyptian', 'Egypt', 'candidate',
   'Verified 2026-09-05: 100 tweets parsed, all Arabic. Newsroom register — volume fallback.'),
  ('x', 'masrawy', 'Masrawy | مصراوي', 'Egyptian', 'Egypt', 'candidate',
   'Verified 2026-09-05: 100 tweets parsed, all Arabic. Newsroom register — volume fallback.'),
  ('x', 'shorouk_news', 'Al Shorouk | الشروق', 'Egyptian', 'Egypt', 'candidate',
   'Verified 2026-09-05: 100 tweets parsed, 99 Arabic. Newsroom register — volume fallback.'),

  -- Yemeni: the thinnest column, and the reason the discovery loop matters
  -- most here. These three are what a first pass could actually reach.
  ('x', 'almasdaronline', 'Al Masdar Online | المصدر أونلاين', 'Yemeni', 'Yemen', 'candidate',
   'Verified 2026-09-05: 99 tweets parsed, all Arabic. Newsroom register; kept because open Yemeni sources are scarce.'),
  ('x', 'MareBpress', 'Marib Press | مأرب برس', 'Yemeni', 'Yemen', 'candidate',
   'Verified 2026-09-05: 100 tweets parsed, all Arabic. Newsroom register — volume fallback.'),
  ('x', 'khabaragency', 'Khabar Agency | وكالة خبر', 'Yemeni', 'Yemen', 'candidate',
   'Verified 2026-09-05: 100 tweets parsed, all Arabic, but the cached set is years old. Watch a harvest before approving.')

ON CONFLICT (platform, handle) DO NOTHING;
