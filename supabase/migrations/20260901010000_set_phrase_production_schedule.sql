-- Give the set-phrase deck a production schedule, mirroring word_reviews.
--
-- Set phrases are the app's formulaic-sequence inventory — the chunks the
-- plateau research says fluency is actually built from
-- (docs/plateau-research-2026-09.md §3: repeated exposure plus deliberate
-- attention to specific sequences is the evidenced lever, and chunk counts in
-- speech track rated fluency). The deck scheduled only one direction: choice
-- answers and spoken answers both graded the same columns, so "I can spot the
-- phrase" and "I can say the phrase" — different skills, the second being the
-- one this app exists for — shared one schedule.
--
-- Columns mirror word_reviews/user_vocabulary exactly (same names, same
-- defaults) so src/lib/spacedRepetition.ts treats every deck identically.
-- FSRS stability lives in *_ease_factor, difficulty in *_difficulty.
--
-- production_next_review_at is nullable: NULL means "never studied in this
-- direction". It is set by the first confident recognition answer (the unlock
-- rule the word decks use) or by the first spoken answer, whichever comes
-- first — a learner who answers by voice from day one starts both tracks at
-- once.

ALTER TABLE public.user_set_phrases
  ADD COLUMN IF NOT EXISTS production_ease_factor numeric NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS production_difficulty numeric NOT NULL DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS production_interval_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_repetitions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_lapses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_next_review_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS production_last_reviewed_at timestamptz NULL;

-- Partial index matching the due query, same shape as the word decks': only
-- rows with an unlocked production track are worth indexing.
CREATE INDEX IF NOT EXISTS idx_user_set_phrases_production_due
  ON public.user_set_phrases (user_id, production_next_review_at)
  WHERE production_next_review_at IS NOT NULL;
