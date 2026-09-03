-- placement_results becomes the home of every proficiency measure, not only
-- the placement quiz (docs/language-learning-plan-2026-09.md, Phase 6b).
--
-- A C-test — a level-controlled passage with the second half of every second
-- word deleted — is the second instrument from the outcome battery the
-- Duolingo efficacy study used. It produces a percentage rather than a CEFR
-- level, so cefr_level becomes nullable, `score` carries the result, and
-- `instrument` says which measure a row is. Existing rows are placements.

ALTER TABLE public.placement_results
  ADD COLUMN IF NOT EXISTS instrument text NOT NULL DEFAULT 'placement',
  ADD COLUMN IF NOT EXISTS score numeric,
  ADD COLUMN IF NOT EXISTS detail jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.placement_results
  ALTER COLUMN cefr_level DROP NOT NULL;

ALTER TABLE public.placement_results
  DROP CONSTRAINT IF EXISTS placement_results_instrument_check;
ALTER TABLE public.placement_results
  ADD CONSTRAINT placement_results_instrument_check
  CHECK (instrument IN ('placement', 'c_test'));
