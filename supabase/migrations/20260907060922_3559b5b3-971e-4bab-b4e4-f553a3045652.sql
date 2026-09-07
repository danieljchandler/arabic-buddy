ALTER TABLE public.social_content_sources
  DROP CONSTRAINT social_content_sources_platform_check;

UPDATE public.social_content_sources
   SET platform = 'x_trends'
 WHERE platform = 'x';

ALTER TABLE public.social_content_sources
  ADD CONSTRAINT social_content_sources_platform_check
  CHECK (platform IN ('x', 'x_trends', 'reddit', 'telegram'));

ALTER TABLE public.social_content_sources
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO public.social_content_sources
  (platform, handle, display_name, dialect, country, status, notes) VALUES
  ('x', 'tamerhosny', 'Tamer Hosny | تامر حسني', 'Egyptian', 'Egypt', 'approved',
   'Verified 2026-09-05: 99 tweets parsed, 93 Arabic. Writes to fans in Egyptian, not press-release Arabic.'),
  ('x', 'amrdiab', 'Amr Diab | عمرو دياب', 'Egyptian', 'Egypt', 'approved',
   'Verified 2026-09-05: 98 tweets parsed, 74 Arabic. Mix of promo and personal; the personal half is dialect.'),
  ('x', 'Mohamed_Ramadan', 'Mohamed Ramadan | محمد رمضان', 'Egyptian', 'Egypt', 'approved',
   'Verified 2026-09-05: 94 tweets parsed, 63 Arabic. High-engagement personal posting.'),
  ('x', 'AlAhly', 'Al Ahly SC | الأهلي', 'Egyptian', 'Egypt', 'approved',
   'Verified 2026-09-05: 99 tweets parsed, 91 Arabic. Club voice — semi-formal, but football register, not wire copy.'),
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
  ('x', 'almasdaronline', 'Al Masdar Online | المصدر أونلاين', 'Yemeni', 'Yemen', 'candidate',
   'Verified 2026-09-05: 99 tweets parsed, all Arabic. Newsroom register; kept because open Yemeni sources are scarce.'),
  ('x', 'MareBpress', 'Marib Press | مأرب برس', 'Yemeni', 'Yemen', 'candidate',
   'Verified 2026-09-05: 100 tweets parsed, all Arabic. Newsroom register — volume fallback.'),
  ('x', 'khabaragency', 'Khabar Agency | وكالة خبر', 'Yemeni', 'Yemen', 'candidate',
   'Verified 2026-09-05: 100 tweets parsed, all Arabic, but the cached set is years old. Watch a harvest before approving.')
ON CONFLICT (platform, handle) DO NOTHING;