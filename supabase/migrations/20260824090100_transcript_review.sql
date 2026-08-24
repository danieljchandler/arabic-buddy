-- Native-speaker transcript review: who may do it, what they signed off on,
-- what they changed, and what they want to say about it.
--
-- The three tables here are all *keyed on a line id inside a JSON blob*.
-- `discover_videos.transcript_lines` is a jsonb array, not rows, so there is no
-- foreign key to hang this off — `line_id` is the `id` field of an element of
-- that array. That is deliberate: the transcript is read as a whole on every
-- screen that shows a video, and splitting it into rows would be a much larger
-- change than adding review state to it.

-- ── Who may review ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_transcriber()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'transcriber')
$$;

-- The audience for the review workspace. Admins and content reviewers already
-- work on this content; a transcriber is the narrow addition — they get here
-- and nowhere else.
CREATE OR REPLACE FUNCTION public.can_review_transcripts()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_admin() OR public.is_content_reviewer() OR public.is_transcriber()
$$;

GRANT EXECUTE ON FUNCTION public.is_transcriber() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_review_transcripts() TO anon, authenticated, service_role;

-- ── Reviewers need to see the videos they are reviewing ─────────────────────
--
-- The old policy was `published = true OR is_admin()`, which meant a content
-- reviewer could only see videos that had already shipped — exactly the ones
-- that no longer need reviewing. A transcriber would have seen nothing at all.
DROP POLICY IF EXISTS "Anyone can view published videos" ON public.discover_videos;
CREATE POLICY "Published videos are public, reviewers see every video"
ON public.discover_videos
FOR SELECT
USING (published = true OR public.can_review_transcripts());

-- ── The checkmark ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transcript_line_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.discover_videos(id) ON DELETE CASCADE,
  -- The `id` of an element of discover_videos.transcript_lines.
  line_id TEXT NOT NULL,
  reviewed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- What the reviewer actually put their name to. A checkmark that outlives the
  -- text it approved is worse than no checkmark: it is a false claim that a
  -- native speaker saw this exact line. Storing the approved text lets the UI
  -- show the tick as stale the moment the Arabic or the English moves on,
  -- including when a merge hands this line's id to a line that now carries
  -- words nobody checked.
  reviewed_arabic TEXT,
  reviewed_translation TEXT,
  UNIQUE (video_id, line_id)
);

ALTER TABLE public.transcript_line_reviews ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS transcript_line_reviews_video_idx
  ON public.transcript_line_reviews (video_id);

-- ── The change log ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transcript_line_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.discover_videos(id) ON DELETE CASCADE,
  -- Null for a change to the video as a whole (cultural notes, grammar points,
  -- vocabulary), which has no single line to attach to.
  line_id TEXT,
  field TEXT NOT NULL CHECK (field IN (
    'arabic', 'translation', 'literal', 'timing', 'structure',
    'cultural_context', 'grammar_points', 'vocabulary'
  )),
  previous_value TEXT,
  new_value TEXT,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Who made the change: a person, or a machine acting on their instruction.
  -- A re-translation the reviewer asked for is still a change to the record and
  -- is logged as one, but it is not a native speaker's judgement and the diff
  -- view says so.
  source TEXT NOT NULL DEFAULT 'human'
    CHECK (source IN ('human', 'ai_retranslate', 'ai_resegment'))
);

ALTER TABLE public.transcript_line_revisions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS transcript_line_revisions_video_idx
  ON public.transcript_line_revisions (video_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS transcript_line_revisions_line_idx
  ON public.transcript_line_revisions (video_id, line_id, changed_at DESC);

-- ── Comments and suggestions ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transcript_line_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.discover_videos(id) ON DELETE CASCADE,
  -- Null for a comment about the video rather than one of its lines.
  line_id TEXT,
  kind TEXT NOT NULL DEFAULT 'comment'
    CHECK (kind IN ('comment', 'suggestion', 'concern')),
  body TEXT NOT NULL CHECK (length(btrim(body)) > 0),
  -- A concrete alternative the reviewer is proposing, kept apart from the prose
  -- so it can be applied with one click instead of copied out of a paragraph.
  suggested_translation TEXT,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.transcript_line_comments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS transcript_line_comments_video_idx
  ON public.transcript_line_comments (video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transcript_line_comments_open_idx
  ON public.transcript_line_comments (video_id) WHERE resolved_at IS NULL;

-- ── RLS: read here, write through the edge function ─────────────────────────
--
-- Reviewers read their own working surface directly, but every write goes
-- through `transcript-review` under the service role. This is the same
-- asymmetry `learner_errors` and `user_concept_mastery` use, and for the same
-- reason: the value of an audit trail is that its subject cannot author it. A
-- client that could POST its own revision rows could sign off on a line it
-- never opened, or record a "previous value" that was never in the database.

CREATE POLICY "Reviewers read line reviews"
ON public.transcript_line_reviews FOR SELECT TO authenticated
USING (public.can_review_transcripts());

CREATE POLICY "Reviewers read line revisions"
ON public.transcript_line_revisions FOR SELECT TO authenticated
USING (public.can_review_transcripts());

CREATE POLICY "Reviewers read line comments"
ON public.transcript_line_comments FOR SELECT TO authenticated
USING (public.can_review_transcripts());

-- ── Let the role show up in the admin grant UI ──────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_managed_roles()
 RETURNS TABLE(id uuid, user_id uuid, role app_role, created_at timestamp with time zone, email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can list managed roles' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT ur.id, ur.user_id, ur.role, ur.created_at, u.email::text
    FROM public.user_roles ur LEFT JOIN auth.users u ON u.id = ur.user_id
    WHERE ur.role::text IN (
      'bible_reader', 'content_reviewer', 'beta_tester', 'complimentary', 'transcriber'
    )
    ORDER BY ur.created_at DESC;
END; $function$;
