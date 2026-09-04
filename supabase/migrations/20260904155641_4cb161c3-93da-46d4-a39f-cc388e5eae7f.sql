-- ── learning_paths ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.learning_paths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_type text NOT NULL,
  goal_description text NOT NULL,
  target_dialect text NOT NULL,
  target_level text NOT NULL,
  timeline_weeks integer NOT NULL DEFAULT 12,
  current_week integer NOT NULL DEFAULT 1,
  curriculum jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learning_paths_user_id_idx ON public.learning_paths(user_id);
ALTER TABLE public.learning_paths ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own learning paths" ON public.learning_paths;
CREATE POLICY "Users manage own learning paths"
  ON public.learning_paths FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_paths TO authenticated;
GRANT ALL ON public.learning_paths TO service_role;

-- ── processed_videos ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.processed_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id text NOT NULL,
  platform text NOT NULL,
  original_url text NOT NULL,
  content_hash text NOT NULL,
  dialect text,
  source_language text,
  duration_seconds integer,
  processing_engines text[],
  transcription_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS processed_videos_video_id_platform_idx
  ON public.processed_videos(video_id, platform);
CREATE INDEX IF NOT EXISTS processed_videos_content_hash_idx ON public.processed_videos(content_hash);
ALTER TABLE public.processed_videos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view processed videos" ON public.processed_videos;
DROP POLICY IF EXISTS "Authenticated users can view processed videos" ON public.processed_videos;
CREATE POLICY "Authenticated users can view processed videos"
  ON public.processed_videos FOR SELECT TO authenticated
  USING (true);
GRANT SELECT ON public.processed_videos TO authenticated;
GRANT ALL ON public.processed_videos TO service_role;

-- ── review_streaks ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.review_streaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  current_streak integer NOT NULL DEFAULT 0,
  longest_streak integer NOT NULL DEFAULT 0,
  last_review_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.review_streaks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own streaks" ON public.review_streaks;
DROP POLICY IF EXISTS "Users can insert their own streaks" ON public.review_streaks;
DROP POLICY IF EXISTS "Users can update their own streaks" ON public.review_streaks;
DROP POLICY IF EXISTS "Users can delete their own streaks" ON public.review_streaks;
DROP POLICY IF EXISTS "Anyone can view public streaks for leaderboard" ON public.review_streaks;
CREATE POLICY "Users can view their own streaks"
  ON public.review_streaks FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own streaks"
  ON public.review_streaks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own streaks"
  ON public.review_streaks FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own streaks"
  ON public.review_streaks FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Anyone can view public streaks for leaderboard"
  ON public.review_streaks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = review_streaks.user_id
        AND profiles.show_on_leaderboard = true
    )
    OR auth.uid() = user_id
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_streaks TO authenticated;
GRANT ALL ON public.review_streaks TO service_role;

-- ── user_difficulty ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_difficulty (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  vocab_difficulty numeric NOT NULL DEFAULT 0.5,
  listening_difficulty numeric NOT NULL DEFAULT 0.5,
  reading_difficulty numeric NOT NULL DEFAULT 0.5,
  speaking_difficulty numeric NOT NULL DEFAULT 0.5,
  vocab_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  listening_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  reading_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  speaking_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_difficulty ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own difficulty" ON public.user_difficulty;
CREATE POLICY "Users manage own difficulty"
  ON public.user_difficulty FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_difficulty TO authenticated;
GRANT ALL ON public.user_difficulty TO service_role;

-- ── weekly_recommendations ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.weekly_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  learning_path_id uuid REFERENCES public.learning_paths(id) ON DELETE SET NULL,
  week_start date NOT NULL,
  focus_areas jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_content jsonb NOT NULL DEFAULT '[]'::jsonb,
  vocab_to_review jsonb NOT NULL DEFAULT '[]'::jsonb,
  performance_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  difficulty_adjustment text,
  motivation_message text,
  motivation_message_arabic text,
  viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS weekly_recommendations_user_week_idx
  ON public.weekly_recommendations(user_id, week_start DESC);
ALTER TABLE public.weekly_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own weekly recommendations" ON public.weekly_recommendations;
DROP POLICY IF EXISTS "Users update own weekly recommendations" ON public.weekly_recommendations;
CREATE POLICY "Users view own weekly recommendations"
  ON public.weekly_recommendations FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users update own weekly recommendations"
  ON public.weekly_recommendations FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
GRANT SELECT, UPDATE ON public.weekly_recommendations TO authenticated;
GRANT ALL ON public.weekly_recommendations TO service_role;
