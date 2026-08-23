-- Clip-pipeline foundation (lower-level video curriculum).
--
-- The beginner curriculum is built from 5-10s authentic clips mined out of a
-- curated channel corpus, not from flashcards. This migration lays the data
-- spine for that pipeline:
--
--   vocab_concepts        the A1 concept list, keyed language-neutrally (the
--                         same shape grammar mastery uses: a fixed key space,
--                         free surface realizations underneath)
--   concept_realizations  per-dialect surface forms + spelling variants for a
--                         concept, draft -> approved like dialect_rules
--   content_channels      the curated channel registry per dialect, with
--                         machine vetting scores (dialect / MSA contamination)
--   channel_videos        every enumerated video of an approved channel
--   caption_lines         the searchable caption/ASR index with timestamps —
--                         "search subtitles, not videos"
--   clip_candidates       (concept, video, start, end) candidates moving
--                         through the automated verification stack
--   lesson_clips          the lesson <-> clip join the product audit calls out
--                         as missing ("which video actually uses the words
--                         this lesson taught")
--
-- Access model follows the repo's asymmetric-read/write pattern: learners read
-- only what lessons need (concepts, approved realizations, lesson_clips);
-- pipeline tables are content-manager + service-role territory. All writes
-- that machines make (harvest, scoring, verification) go through the service
-- role; content managers act through RLS like they do on discover_videos.

-- ---------- vocab_concepts ----------

CREATE TABLE IF NOT EXISTS public.vocab_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable language-neutral key, snake_case English ('dog', 'good_morning').
  -- Lessons and clips reference the concept, never an Arabic string, so one
  -- lesson plan can drive three dialect tracks with different words.
  key text NOT NULL UNIQUE,
  english_gloss text NOT NULL,
  -- Thematic bucket (greetings, food, animals, family, ...) — mirrors the
  -- AVP A1 list's categories; drives the coverage heatmap's rows.
  category text NOT NULL,
  cefr_level text NOT NULL DEFAULT 'A1' CHECK (cefr_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vocab_concepts ENABLE ROW LEVEL SECURITY;

-- Curriculum metadata: everyone reads, content managers write.
CREATE POLICY "vocab_concepts_read" ON public.vocab_concepts
  FOR SELECT USING (true);
CREATE POLICY "vocab_concepts_manage" ON public.vocab_concepts
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT ALL ON public.vocab_concepts TO service_role;

-- ---------- concept_realizations ----------

CREATE TABLE IF NOT EXISTS public.concept_realizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid NOT NULL REFERENCES public.vocab_concepts(id) ON DELETE CASCADE,
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  -- Canonical written form for this dialect.
  surface text NOT NULL,
  -- Alternative spellings the caption search must also match: dialect
  -- orthography is unstandardized (وايد/واجد, شلونك/شلونج), so a realization
  -- without its variants silently misses most of its occurrences.
  variants text[] NOT NULL DEFAULT '{}',
  phonetic text,
  -- Same lifecycle as dialect_rules: AI drafts, a native reviewer approves.
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected')),
  -- Where the draft came from (model lineup, MADAR-informed elicitation, ...)
  -- so a bad batch can be recalled.
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (concept_id, dialect, surface)
);

CREATE INDEX IF NOT EXISTS idx_concept_realizations_concept
  ON public.concept_realizations (concept_id, dialect);

ALTER TABLE public.concept_realizations ENABLE ROW LEVEL SECURITY;

-- Learners see approved forms only; managers see and edit everything.
CREATE POLICY "concept_realizations_read" ON public.concept_realizations
  FOR SELECT USING (status = 'approved' OR public.can_manage_content());
CREATE POLICY "concept_realizations_manage" ON public.concept_realizations
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT ALL ON public.concept_realizations TO service_role;

-- ---------- content_channels ----------

CREATE TABLE IF NOT EXISTS public.content_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: seeded candidates start as a name + handle from research; the
  -- harvest script resolves the real channel id before first enumeration.
  yt_channel_id text UNIQUE,
  name text NOT NULL,
  handle text,
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  -- Sub-accent info worth keeping even though the app treats Khaliji as one
  -- track (Saudi/Kuwaiti/Emirati/... for Gulf; null elsewhere).
  country text,
  genre text,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'rejected')),
  -- Machine vetting, written by the scorer over harvested caption lines:
  -- dialect_score is marker density for the channel's claimed dialect,
  -- msa_score is MSA-marker contamination. Both 0..1. A channel is auto-vetted
  -- by these and confirmed by a human skim, so the numbers are advisory.
  dialect_score real,
  msa_score real,
  notes text,
  last_harvested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Seed idempotency key: candidates arrive as (name, dialect) before their
  -- yt_channel_id is resolved.
  UNIQUE (name, dialect)
);

ALTER TABLE public.content_channels ENABLE ROW LEVEL SECURITY;

-- Pipeline-internal: not learner-facing.
CREATE POLICY "content_channels_manage" ON public.content_channels
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT ALL ON public.content_channels TO service_role;

-- ---------- channel_videos ----------

CREATE TABLE IF NOT EXISTS public.channel_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.content_channels(id) ON DELETE CASCADE,
  yt_video_id text NOT NULL UNIQUE,
  title text NOT NULL DEFAULT '',
  duration_seconds integer,
  published_at timestamptz,
  -- What transcript material exists for this video. 'asr' means our own
  -- pipeline transcribed it (the precision layer over YouTube's captions).
  caption_status text NOT NULL DEFAULT 'unknown'
    CHECK (caption_status IN ('unknown', 'none', 'auto', 'manual', 'asr')),
  -- Link-rot state, refreshed by the availability sweep (videos.list batches +
  -- oEmbed HEADs). embeddable=false filters a video out of candidacy entirely:
  -- the learner surface is 100% iframe embeds.
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

-- ---------- caption_lines ----------

CREATE TABLE IF NOT EXISTS public.caption_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.channel_videos(id) ON DELETE CASCADE,
  start_ms integer NOT NULL,
  end_ms integer NOT NULL,
  text text NOT NULL,
  -- Arabic-normalized (msaLeakDetector.normalizeArabic — the one shared
  -- normalization) at write time, so FTS and marker scoring never disagree
  -- with the app about what counts as the same word.
  text_normalized text NOT NULL,
  source text NOT NULL CHECK (source IN ('auto', 'manual', 'asr')),
  -- Which engine produced an 'asr' row (soniox, munsit, deepgram, ...).
  asr_engine text,
  -- Line-level scores from the marker scorer. Line-level, not just
  -- channel-level, because dialect channels drift into MSA in intros and
  -- scripted voice-overs — the line score is what catches that.
  dialect_score real,
  msa_score real,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_ms > start_ms)
);

CREATE INDEX IF NOT EXISTS idx_caption_lines_video
  ON public.caption_lines (video_id, start_ms);
-- 'simple' config: Arabic has no stock Postgres stemmer, and the text is
-- already normalized in app code, so plain lexeme matching is the right tool.
CREATE INDEX IF NOT EXISTS idx_caption_lines_fts
  ON public.caption_lines USING gin (to_tsvector('simple', text_normalized));

ALTER TABLE public.caption_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "caption_lines_manage" ON public.caption_lines
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT ALL ON public.caption_lines TO service_role;

-- Concept-driven clip search: given already-normalized query terms (the
-- realization's surface + variants), return candidate lines in the 5-10s
-- window, best dialect fit first. SECURITY DEFINER so the planner can use the
-- expression index; execution is gated to the same audience as the tables.
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

-- ---------- clip_candidates ----------

CREATE TABLE IF NOT EXISTS public.clip_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid REFERENCES public.vocab_concepts(id) ON DELETE SET NULL,
  video_id uuid NOT NULL REFERENCES public.channel_videos(id) ON DELETE CASCADE,
  caption_line_id uuid REFERENCES public.caption_lines(id) ON DELETE SET NULL,
  start_ms integer NOT NULL,
  end_ms integer NOT NULL,
  -- The verification lifecycle. Machines move pending -> verified (all checks
  -- agree) or needs_review (a verifier dissented); verified clips auto-publish
  -- by ingesting through the normal discover_videos pipeline; humans work only
  -- the needs_review queue and can reject anywhere.
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'needs_review', 'published', 'rejected')),
  rank_score real,
  -- Per-verifier results (ASR agreement, dialect score, visual check, safety),
  -- kept whole so the audit queue can show *why* a clip was held, and so the
  -- thresholds can be re-tuned over history without re-running the stack.
  verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Set when a verified clip is ingested as a real discover_videos row.
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

-- ---------- lesson_clips ----------

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

-- Lesson content: learners read, managers write. The referenced
-- discover_videos row still gates on published=true for its own reads, so an
-- unpublished clip never leaks transcript content through this table.
CREATE POLICY "lesson_clips_read" ON public.lesson_clips
  FOR SELECT USING (true);
CREATE POLICY "lesson_clips_manage" ON public.lesson_clips
  FOR ALL USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());
GRANT ALL ON public.lesson_clips TO service_role;
