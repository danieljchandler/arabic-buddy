-- Self-recorded monologue attempts and their utterance-fluency metrics.
--
-- The monologue feature (docs/plateau-plan-2026-09.md, Phase 1-2) records the
-- learner speaking freely for a level-scaled stretch, transcribes it with
-- word-level timestamps, and computes speed/pause measures in
-- _shared/fluencyMetricsCore.ts. No Arabic fluency norms exist anywhere
-- (docs/plateau-research-2026-09.md §5), so v1 shows the learner trends over
-- their own attempts and this table is the calibration corpus that future
-- banding will be derived from. That is why `metrics` keeps the full raw
-- output (per-gap pause inventory included) rather than a summary: better
-- measures — Arabic-aware pause-location coding above all — must be
-- re-derivable from stored attempts without re-transcribing audio we no
-- longer have.
--
-- Same asymmetric access pattern as learner_errors: rows are written only by
-- the score-monologue edge function under the service role (a fluency history
-- the learner could author is worth nothing as a calibration corpus), and read
-- by their owner. No client UPDATE at all — unlike learner_errors there is
-- nothing here for the owner to resolve.

CREATE TABLE public.monologue_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dialect text NOT NULL DEFAULT 'Gulf',
  -- The prompt the learner spoke to, denormalised: prompts are generated
  -- per-learner and have no table of their own yet (plan Phase 2b).
  prompt_text text,
  -- What the client measured, so trailing silence after the last recognised
  -- word is real data rather than lost.
  duration_ms integer NOT NULL,
  transcript text NOT NULL DEFAULT '',
  word_count integer NOT NULL DEFAULT 0,
  -- Full FluencyMetrics output. Empty object when the ASR fallback returned
  -- no word timings (timings_available says which).
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  asr_provider text NOT NULL DEFAULT 'soniox',
  timings_available boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The read pattern is the trend view: this user's attempts, newest first,
-- usually filtered to the active dialect.
CREATE INDEX idx_monologue_attempts_user_recent
  ON public.monologue_attempts (user_id, dialect, created_at DESC);

GRANT SELECT ON public.monologue_attempts TO authenticated;
GRANT ALL ON public.monologue_attempts TO service_role;

ALTER TABLE public.monologue_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own monologue attempts"
  ON public.monologue_attempts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
