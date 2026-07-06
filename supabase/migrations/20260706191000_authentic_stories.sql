-- Authentic Stories feature: reading & listening practice from public domain Arabic literature

-- Main stories table
CREATE TABLE public.authentic_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  title_arabic text NOT NULL,
  author text,
  author_arabic text,
  source_url text,
  source_name text,
  license text DEFAULT 'public_domain',
  body_fusha text,
  body_fusha_vocalized text,
  body_dialect text,
  body_dialect_vocalized text,
  body_english text,
  dialect text,
  difficulty text DEFAULT 'intermediate' CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  vocabulary jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'content_approved', 'video_preview', 'published')),
  video_status text DEFAULT 'none' CHECK (video_status IN ('none', 'preview_generated', 'generating', 'ready', 'failed')),
  video_preview_url text,
  video_url text,
  audio_url text,
  line_durations jsonb,
  duration_seconds numeric,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Per-line breakdown for synced reading
CREATE TABLE public.authentic_story_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES public.authentic_stories(id) ON DELETE CASCADE,
  line_index integer NOT NULL,
  arabic text,
  arabic_vocalized text,
  dialect text,
  dialect_vocalized text,
  english text,
  audio_url text,
  duration_seconds numeric,
  UNIQUE (story_id, line_index)
);

-- Indexes
CREATE INDEX idx_authentic_stories_status ON public.authentic_stories(status);
CREATE INDEX idx_authentic_stories_difficulty ON public.authentic_stories(difficulty);
CREATE INDEX idx_authentic_stories_dialect ON public.authentic_stories(dialect);
CREATE INDEX idx_authentic_story_lines_story_id ON public.authentic_story_lines(story_id);

-- Updated_at trigger
CREATE TRIGGER set_authentic_stories_updated_at
  BEFORE UPDATE ON public.authentic_stories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.authentic_stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authentic_story_lines ENABLE ROW LEVEL SECURITY;

-- Stories: public can read published, admin can do everything
CREATE POLICY "Anyone can view published authentic stories"
  ON public.authentic_stories FOR SELECT
  USING (status = 'published' OR public.is_admin());

CREATE POLICY "Admins can insert authentic stories"
  ON public.authentic_stories FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update authentic stories"
  ON public.authentic_stories FOR UPDATE
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete authentic stories"
  ON public.authentic_stories FOR DELETE
  USING (public.is_admin());

-- Story lines: readable if parent story is readable, admin can manage
CREATE POLICY "Anyone can view lines of published stories"
  ON public.authentic_story_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.authentic_stories s
      WHERE s.id = story_id
        AND (s.status = 'published' OR public.is_admin())
    )
  );

CREATE POLICY "Admins can insert story lines"
  ON public.authentic_story_lines FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update story lines"
  ON public.authentic_story_lines FOR UPDATE
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete story lines"
  ON public.authentic_story_lines FOR DELETE
  USING (public.is_admin());
