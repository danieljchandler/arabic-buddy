-- The post-video debrief: a guided chat about a video the learner has just watched.
-- Static layer: per-video study guide; live layer: per-learner word signals.

CREATE TABLE IF NOT EXISTS public.video_study_guides (
  video_id uuid PRIMARY KEY REFERENCES public.discover_videos(id) ON DELETE CASCADE,
  guide jsonb NOT NULL,
  transcript_hash text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.video_study_guides FROM anon, authenticated;
GRANT ALL ON public.video_study_guides TO service_role;

ALTER TABLE public.video_study_guides ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.video_word_lookups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES public.discover_videos(id) ON DELETE CASCADE,
  word_arabic text NOT NULL,
  word_english text,
  line_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, video_id, word_arabic)
);

CREATE INDEX IF NOT EXISTS idx_video_word_lookups_user_video
  ON public.video_word_lookups (user_id, video_id);

GRANT SELECT, INSERT, DELETE ON public.video_word_lookups TO authenticated;
GRANT ALL ON public.video_word_lookups TO service_role;

ALTER TABLE public.video_word_lookups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own word lookups"
  ON public.video_word_lookups
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can record their own word lookups"
  ON public.video_word_lookups
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own word lookups"
  ON public.video_word_lookups
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

ALTER TABLE public.user_vocabulary
  ADD COLUMN IF NOT EXISTS source_video_id uuid REFERENCES public.discover_videos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_vocabulary_source_video
  ON public.user_vocabulary (user_id, source_video_id)
  WHERE source_video_id IS NOT NULL;