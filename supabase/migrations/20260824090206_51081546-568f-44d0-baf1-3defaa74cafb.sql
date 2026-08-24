CREATE OR REPLACE FUNCTION public.is_transcriber()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'transcriber')
$$;

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

DROP POLICY IF EXISTS "Anyone can view published videos" ON public.discover_videos;
CREATE POLICY "Published videos are public, reviewers see every video"
ON public.discover_videos
FOR SELECT
USING (published = true OR public.can_review_transcripts());

CREATE TABLE IF NOT EXISTS public.transcript_line_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.discover_videos(id) ON DELETE CASCADE,
  line_id TEXT NOT NULL,
  reviewed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_arabic TEXT,
  reviewed_translation TEXT,
  UNIQUE (video_id, line_id)
);

ALTER TABLE public.transcript_line_reviews ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS transcript_line_reviews_video_idx
  ON public.transcript_line_reviews (video_id);

CREATE TABLE IF NOT EXISTS public.transcript_line_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.discover_videos(id) ON DELETE CASCADE,
  line_id TEXT,
  field TEXT NOT NULL CHECK (field IN (
    'arabic', 'translation', 'literal', 'timing', 'structure',
    'cultural_context', 'grammar_points', 'vocabulary'
  )),
  previous_value TEXT,
  new_value TEXT,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'human'
    CHECK (source IN ('human', 'ai_retranslate', 'ai_resegment'))
);

ALTER TABLE public.transcript_line_revisions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS transcript_line_revisions_video_idx
  ON public.transcript_line_revisions (video_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS transcript_line_revisions_line_idx
  ON public.transcript_line_revisions (video_id, line_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS public.transcript_line_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.discover_videos(id) ON DELETE CASCADE,
  line_id TEXT,
  kind TEXT NOT NULL DEFAULT 'comment'
    CHECK (kind IN ('comment', 'suggestion', 'concern')),
  body TEXT NOT NULL CHECK (length(btrim(body)) > 0),
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

CREATE POLICY "Reviewers read line reviews"
ON public.transcript_line_reviews FOR SELECT TO authenticated
USING (public.can_review_transcripts());

CREATE POLICY "Reviewers read line revisions"
ON public.transcript_line_revisions FOR SELECT TO authenticated
USING (public.can_review_transcripts());

CREATE POLICY "Reviewers read line comments"
ON public.transcript_line_comments FOR SELECT TO authenticated
USING (public.can_review_transcripts());

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