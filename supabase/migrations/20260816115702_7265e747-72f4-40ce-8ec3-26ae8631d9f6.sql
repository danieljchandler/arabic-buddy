ALTER TABLE public.discover_videos
  ADD COLUMN IF NOT EXISTS visual_timeline jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.discover_videos.visual_timeline IS
  'Timestamped on-screen text and scene notes from extract-visual-context. Read by the Ask AI assistant to ground answers in what is visible at the learner''s current position.';

CREATE TABLE IF NOT EXISTS public.learner_ai_memory (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  summary text NOT NULL DEFAULT '',
  open_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  turns_seen integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dialect)
);

GRANT SELECT, DELETE ON public.learner_ai_memory TO authenticated;
GRANT ALL ON public.learner_ai_memory TO service_role;

ALTER TABLE public.learner_ai_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "learners read their own AI memory" ON public.learner_ai_memory;
CREATE POLICY "learners read their own AI memory"
  ON public.learner_ai_memory FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "learners delete their own AI memory" ON public.learner_ai_memory;
CREATE POLICY "learners delete their own AI memory"
  ON public.learner_ai_memory FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);