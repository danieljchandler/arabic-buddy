-- Seed the social source registry (see 20260828120000_social_trends_foundation).
--
-- Statuses reflect what was actually verified on 2026-08-28:
--   approved   fetched live and parsed (trend rows / message previews came
--              back non-empty through the harvest path)
--   candidate  plausible but unverified — VERIFY: notes say what to check.
-- Telegram rows are news-weighted because news channels are the ones that
-- reliably enable public previews; the MSA screen is what keeps the feed
-- dialectal, and the registry is where reviewers should add meme/comedy
-- channels as they find preview-enabled ones.
-- Yemen has no X trends row on purpose: X publishes no Yemen trend location,
-- which is exactly why the Yemeni column leans on Telegram and Reddit.

INSERT INTO public.social_content_sources
  (platform, handle, display_name, dialect, country, status, notes) VALUES

  -- ---------- X trend countries (getdaytrends slugs) ----------
  ('x', 'saudi-arabia', 'Saudi Arabia trends', 'Gulf', 'Saudi Arabia', 'approved',
   'Verified 2026-08-28: trend table parses via Jina.'),
  ('x', 'kuwait', 'Kuwait trends', 'Gulf', 'Kuwait', 'approved', NULL),
  ('x', 'united-arab-emirates', 'UAE trends', 'Gulf', 'UAE', 'approved', NULL),
  ('x', 'qatar', 'Qatar trends', 'Gulf', 'Qatar', 'approved', NULL),
  ('x', 'bahrain', 'Bahrain trends', 'Gulf', 'Bahrain', 'approved', NULL),
  ('x', 'oman', 'Oman trends', 'Gulf', 'Oman', 'approved', NULL),
  ('x', 'egypt', 'Egypt trends', 'Egyptian', 'Egypt', 'approved', NULL),

  -- ---------- Reddit country subreddits ----------
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

  -- ---------- Telegram public channels (t.me/s previews) ----------
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
