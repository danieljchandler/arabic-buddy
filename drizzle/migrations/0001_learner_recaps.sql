-- The daily recap: a guided tutor session over what a learner did yesterday
-- (or, when yesterday was empty, over the last week).
-- One row per learner, dialect and local day holds the session plan.

CREATE TABLE IF NOT EXISTS public.learner_recaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dialect text NOT NULL,
  recap_date date NOT NULL,
  window_days integer NOT NULL DEFAULT 1,
  plan jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ready',
  outcome jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dialect, recap_date),
  CONSTRAINT learner_recaps_status_check CHECK (status IN ('ready', 'completed'))
);

CREATE INDEX IF NOT EXISTS idx_learner_recaps_user_date
  ON public.learner_recaps (user_id, recap_date DESC);

REVOKE ALL ON public.learner_recaps FROM anon;
GRANT SELECT ON public.learner_recaps TO authenticated;
GRANT ALL ON public.learner_recaps TO service_role;

ALTER TABLE public.learner_recaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own recaps"
  ON public.learner_recaps
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);