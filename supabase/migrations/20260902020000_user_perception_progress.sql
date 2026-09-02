-- Perception training progress (docs/language-learning-plan-2026-09.md,
-- Phase 2; research §5b).
--
-- One row per learner × dialect × contrast (ص/س, ط/ت, ق/ك, ح/ه, ع/ء, …).
-- The programme is finite by design — gains from perception training rise
-- linearly to ~400 minutes and plateau — so the row carries time as well as
-- accuracy, and completion is a state a contrast reaches.
--
-- Client-writable, like user_letter_progress: this is the learner's own
-- self-graded practice with nothing to gain by inflating it, the same trust
-- level as the alphabet journey. (Scores that feed generation or drills stay
-- service-role-only; this feeds a progress bar.)
--
-- The resurface_* columns exist to measure something the literature has not:
-- whether perception gains in Arabic last. A completed contrast is offered
-- again after RESURFACE_AFTER_DAYS and the first-attempt accuracy is kept
-- separately, so the two can be compared later.

CREATE TABLE public.user_perception_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dialect text NOT NULL DEFAULT 'Gulf',
  contrast_id text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  correct integer NOT NULL DEFAULT 0,
  -- Practice time, in seconds, summed over rounds.
  seconds integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  resurfaced_at timestamptz,
  resurface_attempts integer NOT NULL DEFAULT 0,
  resurface_correct integer NOT NULL DEFAULT 0,
  last_practiced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dialect, contrast_id)
);

ALTER TABLE public.user_perception_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own perception progress" ON public.user_perception_progress
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own perception progress" ON public.user_perception_progress
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own perception progress" ON public.user_perception_progress
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own perception progress" ON public.user_perception_progress
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_user_perception_progress_updated_at
  BEFORE UPDATE ON public.user_perception_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_user_perception_progress_user
  ON public.user_perception_progress (user_id, dialect);
