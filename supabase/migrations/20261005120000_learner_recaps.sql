-- The daily recap: a guided tutor session over what a learner did yesterday
-- (or, when yesterday was empty, over the last week) — the videos they
-- watched, the words they saved or looked up, the slips the practice surfaces
-- caught, the lesson or story they read.
--
-- One row per learner, dialect and local day holds the session plan the
-- daily-recap function built, so the quiz the page shows is the quiz the tutor
-- is told about on every later turn, and so the strip at the bottom of the
-- screen can say whether today's recap is done. Written only by the function
-- under the service role; a learner reads their own rows.
--
-- Apply this to the live project (Lovable or `supabase db push`); a migration
-- merged through GitHub alone is not applied there, and the next types
-- regeneration would drop these columns from types.ts. See CLAUDE.md. Until it
-- is applied the feature degrades rather than breaks: the plan is rebuilt on
-- every request (the same plan — it is deterministic) and completion is not
-- remembered.

CREATE TABLE IF NOT EXISTS public.learner_recaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dialect text NOT NULL,
  -- The learner's local date the recap was built for (their "today").
  recap_date date NOT NULL,
  -- How many local days the plan's window covered: 1 for yesterday, 7 for the week.
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
