-- Persist shadowing attempts, which until now lived only in React state.
--
-- Two payoffs (docs/plateau-plan-2026-09.md, Phase 5):
--   1. The rep model — shadowing works by repeating ONE clip about five times
--      before gains plateau, and a per-clip progression needs the takes
--      stored to be shown.
--   2. Durability measurement. Gains' persistence over time is unverified in
--      the shadowing literature (one delayed post-test in 44 studies), so we
--      measure it ourselves: resurface a previously-plateaued clip after N
--      days and compare first-take scores. That analysis needs history.
--
-- Same asymmetric access pattern as learner_errors and monologue_attempts:
-- rows are written by score-shadow-attempt under the service role, read by
-- their owner. Anonymous takes (the page works signed-out) simply don't
-- persist — there is no one to store them for.

CREATE TABLE public.shadow_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dialect text NOT NULL DEFAULT 'Gulf',
  -- Stable id of the clip inside its source (video id + line id, or saved
  -- transcription + line). Text rather than an FK: clips live inside jsonb
  -- transcript arrays, not rows.
  clip_ref text NOT NULL,
  -- 1-based take number within one practice of this clip.
  rep integer NOT NULL DEFAULT 1,
  reference_text text NOT NULL,
  recognized_text text NOT NULL DEFAULT '',
  -- Raw 0..1 similarity from the scorer, before the display calibration in
  -- src/lib/shadowScoring.ts — stored raw so recalibrations don't orphan
  -- history.
  transcript_similarity numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The read patterns: this clip's progression, and this user's recent work.
CREATE INDEX idx_shadow_attempts_user_clip
  ON public.shadow_attempts (user_id, clip_ref, created_at DESC);

GRANT SELECT ON public.shadow_attempts TO authenticated;
GRANT ALL ON public.shadow_attempts TO service_role;

ALTER TABLE public.shadow_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own shadow attempts"
  ON public.shadow_attempts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
