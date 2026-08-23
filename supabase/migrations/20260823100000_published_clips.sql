-- The learner-facing clip surface.
--
-- clip_candidates is pipeline-internal (verification evidence, manager-only
-- RLS) and the ingested discover_videos row for a source video stays
-- unpublished — a 10-minute vlog nobody vetted must not reach the feed just
-- because 4 seconds of it make a good clip. What learners get instead is this
-- table: one row per published clip, carrying exactly what playback needs —
-- the YouTube id and window for the official iframe embed, the caption line,
-- and a translation generated at publish time. publish-verified-clips is the
-- only writer.

CREATE TABLE IF NOT EXISTS public.published_clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Provenance back into the pipeline; the clip outlives its candidate.
  clip_candidate_id uuid REFERENCES public.clip_candidates(id) ON DELETE SET NULL,
  concept_id uuid REFERENCES public.vocab_concepts(id) ON DELETE SET NULL,
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  yt_video_id text NOT NULL,
  start_ms integer NOT NULL,
  end_ms integer NOT NULL,
  -- The Arabic word/phrase the clip teaches, and its gloss (from the concept
  -- when there is one) — what "save this word" writes into the SRS.
  term text NOT NULL,
  term_gloss text,
  -- The caption line as spoken, and its publish-time translation.
  arabic text NOT NULL,
  translation text NOT NULL,
  transliteration text,
  channel_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One clip per exact window: re-publishing the same moment is a no-op.
  UNIQUE (yt_video_id, start_ms, end_ms),
  CHECK (end_ms > start_ms)
);

CREATE INDEX IF NOT EXISTS idx_published_clips_dialect
  ON public.published_clips (dialect, concept_id);

ALTER TABLE public.published_clips ENABLE ROW LEVEL SECURITY;

-- Published learner content: everyone reads, managers curate, the pipeline
-- writes under the service role.
CREATE POLICY "published_clips_read" ON public.published_clips
  FOR SELECT USING (true);
CREATE POLICY "published_clips_manage" ON public.published_clips
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT ALL ON public.published_clips TO service_role;
