CREATE TABLE IF NOT EXISTS public.vocab_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  english_gloss text NOT NULL,
  category text NOT NULL,
  cefr_level text NOT NULL DEFAULT 'A1' CHECK (cefr_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vocab_concepts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vocab_concepts_read" ON public.vocab_concepts
  FOR SELECT USING (true);
CREATE POLICY "vocab_concepts_manage" ON public.vocab_concepts
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT ALL ON public.vocab_concepts TO service_role;

CREATE TABLE IF NOT EXISTS public.concept_realizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid NOT NULL REFERENCES public.vocab_concepts(id) ON DELETE CASCADE,
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  surface text NOT NULL,
  variants text[] NOT NULL DEFAULT '{}',
  phonetic text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected')),
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (concept_id, dialect, surface)
);

CREATE INDEX IF NOT EXISTS idx_concept_realizations_concept
  ON public.concept_realizations (concept_id, dialect);

ALTER TABLE public.concept_realizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "concept_realizations_read" ON public.concept_realizations
  FOR SELECT USING (status = 'approved' OR public.can_manage_content());
CREATE POLICY "concept_realizations_manage" ON public.concept_realizations
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT ALL ON public.concept_realizations TO service_role;

CREATE TABLE IF NOT EXISTS public.content_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yt_channel_id text UNIQUE,
  name text NOT NULL,
  handle text,
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  country text,
  genre text,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'rejected')),
  dialect_score real,
  msa_score real,
  notes text,
  last_harvested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, dialect)
);

ALTER TABLE public.content_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_channels_manage" ON public.content_channels
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT ALL ON public.content_channels TO service_role;

CREATE TABLE IF NOT EXISTS public.channel_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.content_channels(id) ON DELETE CASCADE,
  yt_video_id text NOT NULL UNIQUE,
  title text NOT NULL DEFAULT '',
  duration_seconds integer,
  published_at timestamptz,
  caption_status text NOT NULL DEFAULT 'unknown'
    CHECK (caption_status IN ('unknown', 'none', 'auto', 'manual', 'asr')),
  availability text NOT NULL DEFAULT 'unknown'
    CHECK (availability IN ('unknown', 'available', 'unavailable')),
  embeddable boolean,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_videos_channel
  ON public.channel_videos (channel_id);

ALTER TABLE public.channel_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_videos_manage" ON public.channel_videos
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT ALL ON public.channel_videos TO service_role;

CREATE TABLE IF NOT EXISTS public.caption_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.channel_videos(id) ON DELETE CASCADE,
  start_ms integer NOT NULL,
  end_ms integer NOT NULL,
  text text NOT NULL,
  text_normalized text NOT NULL,
  source text NOT NULL CHECK (source IN ('auto', 'manual', 'asr')),
  asr_engine text,
  dialect_score real,
  msa_score real,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_ms > start_ms)
);

CREATE INDEX IF NOT EXISTS idx_caption_lines_video
  ON public.caption_lines (video_id, start_ms);
CREATE INDEX IF NOT EXISTS idx_caption_lines_fts
  ON public.caption_lines USING gin (to_tsvector('simple', text_normalized));

ALTER TABLE public.caption_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "caption_lines_manage" ON public.caption_lines
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT ALL ON public.caption_lines TO service_role;

CREATE OR REPLACE FUNCTION public.search_caption_lines(
  q_terms text[],
  q_dialect text DEFAULT NULL,
  min_duration_ms integer DEFAULT 1200,
  max_duration_ms integer DEFAULT 10000,
  match_count integer DEFAULT 50
)
RETURNS TABLE (
  line_id uuid,
  video_id uuid,
  yt_video_id text,
  video_title text,
  channel_name text,
  channel_dialect text,
  start_ms integer,
  end_ms integer,
  line_text text,
  line_source text,
  line_dialect_score real,
  line_msa_score real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $search$
  SELECT
    cl.id,
    cl.video_id,
    cv.yt_video_id,
    cv.title,
    cc.name,
    cc.dialect,
    cl.start_ms,
    cl.end_ms,
    cl.text,
    cl.source,
    cl.dialect_score,
    cl.msa_score
  FROM public.caption_lines cl
  JOIN public.channel_videos cv ON cv.id = cl.video_id
  JOIN public.content_channels cc ON cc.id = cv.channel_id
  WHERE public.can_manage_content()
    AND to_tsvector('simple', cl.text_normalized)
        @@ to_tsquery('simple', array_to_string(q_terms, ' | '))
    AND (q_dialect IS NULL OR cc.dialect = q_dialect)
    AND (cl.end_ms - cl.start_ms) BETWEEN min_duration_ms AND max_duration_ms
    AND cv.availability <> 'unavailable'
    AND cv.embeddable IS DISTINCT FROM false
  ORDER BY
    COALESCE(cl.dialect_score, 0) - COALESCE(cl.msa_score, 0) DESC,
    cl.created_at DESC
  LIMIT LEAST(GREATEST(match_count, 1), 200)
$search$;

REVOKE ALL ON FUNCTION public.search_caption_lines(text[], text, integer, integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.search_caption_lines(text[], text, integer, integer, integer) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.clip_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid REFERENCES public.vocab_concepts(id) ON DELETE SET NULL,
  video_id uuid NOT NULL REFERENCES public.channel_videos(id) ON DELETE CASCADE,
  caption_line_id uuid REFERENCES public.caption_lines(id) ON DELETE SET NULL,
  start_ms integer NOT NULL,
  end_ms integer NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'needs_review', 'published', 'rejected')),
  rank_score real,
  verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  discover_video_id uuid REFERENCES public.discover_videos(id) ON DELETE SET NULL,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_ms > start_ms)
);

CREATE INDEX IF NOT EXISTS idx_clip_candidates_status
  ON public.clip_candidates (status, created_at);
CREATE INDEX IF NOT EXISTS idx_clip_candidates_concept
  ON public.clip_candidates (concept_id);

ALTER TABLE public.clip_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clip_candidates_manage" ON public.clip_candidates
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT ALL ON public.clip_candidates TO service_role;

CREATE TABLE IF NOT EXISTS public.lesson_clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  discover_video_id uuid NOT NULL REFERENCES public.discover_videos(id) ON DELETE CASCADE,
  start_ms integer NOT NULL,
  end_ms integer NOT NULL,
  concept_id uuid REFERENCES public.vocab_concepts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, position),
  CHECK (end_ms > start_ms)
);

CREATE INDEX IF NOT EXISTS idx_lesson_clips_lesson
  ON public.lesson_clips (lesson_id, position);

ALTER TABLE public.lesson_clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lesson_clips_read" ON public.lesson_clips
  FOR SELECT USING (true);
CREATE POLICY "lesson_clips_manage" ON public.lesson_clips
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT ALL ON public.lesson_clips TO service_role;

-- Grant fix-up: PostgREST checks table-level grants before RLS. Without these,
-- the learner WordClips page (vocab_concepts) and admin workbench
-- (content_channels, clip_candidates) get permission errors despite policies.
GRANT SELECT ON public.vocab_concepts TO anon, authenticated;
GRANT SELECT ON public.concept_realizations TO anon, authenticated;
GRANT SELECT ON public.lesson_clips TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_channels TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_videos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.caption_lines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clip_candidates TO authenticated;