-- Per-learner FSRS-6 weights (docs/language-learning-plan-2026-09.md, Phase 4).
--
-- On the maintainers' benchmark, fitting the 21 weights to the individual
-- learner is worth more than an algorithm version: FSRS-7 on stock weights
-- scores worse than per-learner FSRS-5 (research §1). review_log now holds
-- the history a fit needs; this is where the result lives.
--
-- Client-writable like desired_retention: the weights schedule only this
-- learner's own cards, and the scheduler clamps them on read
-- (spacedRepetition.resolveWeights rejects a wrong-length or non-finite
-- vector whole), so a hand-edited row cannot produce a degenerate schedule
-- for anyone else. fsrs_weights_reviews records how much history the fit
-- rested on, so a fit from too little can be shown as such and refitted.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS fsrs_weights jsonb,
  ADD COLUMN IF NOT EXISTS fsrs_weights_fitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS fsrs_weights_reviews integer;
