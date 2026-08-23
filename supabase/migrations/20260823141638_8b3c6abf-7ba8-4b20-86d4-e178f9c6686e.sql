CREATE TABLE IF NOT EXISTS public.published_clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_candidate_id uuid REFERENCES public.clip_candidates(id) ON DELETE SET NULL,
  concept_id uuid REFERENCES public.vocab_concepts(id) ON DELETE SET NULL,
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  yt_video_id text NOT NULL,
  start_ms integer NOT NULL,
  end_ms integer NOT NULL,
  term text NOT NULL,
  term_gloss text,
  arabic text NOT NULL,
  translation text NOT NULL,
  transliteration text,
  channel_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (yt_video_id, start_ms, end_ms),
  CHECK (end_ms > start_ms)
);

CREATE INDEX IF NOT EXISTS idx_published_clips_dialect
  ON public.published_clips (dialect, concept_id);

ALTER TABLE public.published_clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "published_clips_read" ON public.published_clips
  FOR SELECT USING (true);
CREATE POLICY "published_clips_manage" ON public.published_clips
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT ALL ON public.published_clips TO service_role;

-- Grant fix-up: learners read this table directly from the WordClips page.
GRANT SELECT ON public.published_clips TO anon, authenticated;