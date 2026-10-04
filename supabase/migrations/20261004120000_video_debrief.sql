-- The post-video debrief: a guided chat about a video the learner has just
-- watched (comprehension questions, a quiz on the words they were unsure of,
-- one or two lines to shadow, then open questions).
--
-- It joins two layers. The static one is per video and shared by every
-- learner: a study guide written once from the transcript and its
-- translations, so the tutor does not re-read a whole transcript from scratch
-- on every turn. The live one is per learner: which words they saved while
-- watching and which they only looked up. This migration adds a home for the
-- static layer and the two signals the live layer needs.
--
-- Apply this to the live project (Lovable or `supabase db push`); a migration
-- merged through GitHub alone is not applied there, and the next types
-- regeneration would drop these columns from types.ts. See CLAUDE.md. Until it
-- is applied the feature degrades rather than breaks: guides are generated but
-- not cached, look-ups are not recorded, and saved words are matched to the
-- video by their sentence instead of by id.

-- 1. The study guide. One row per video, written and read only by the
--    video-study-guide and video-debrief functions under the service role. It
--    carries the answer key to the comprehension questions, which is why no
--    client role can read it.
CREATE TABLE IF NOT EXISTS public.video_study_guides (
  video_id uuid PRIMARY KEY REFERENCES public.discover_videos(id) ON DELETE CASCADE,
  guide jsonb NOT NULL,
  -- Hash of the spoken transcript the guide was written from. Reviewers edit
  -- transcripts after ingest; a guide whose line ids or wording no longer
  -- match is regenerated the next time anyone opens the debrief.
  transcript_hash text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.video_study_guides FROM anon, authenticated;
GRANT ALL ON public.video_study_guides TO service_role;

ALTER TABLE public.video_study_guides ENABLE ROW LEVEL SECURITY;

-- 2. Words a learner looked up in a video without saving. Tapping a word for
--    its meaning is the clearest "I wasn't sure" signal the page has, and it
--    used to vanish when the popover closed. One row per word per video: the
--    debrief only needs to know that it happened.
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

-- 3. Which video a saved word came from. `source` only ever said "discover",
--    so the debrief could not ask which words were saved from *this* video.
--    Null for everything saved before this column, and for words saved
--    anywhere else; the debrief falls back to matching those by sentence.
ALTER TABLE public.user_vocabulary
  ADD COLUMN IF NOT EXISTS source_video_id uuid REFERENCES public.discover_videos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_vocabulary_source_video
  ON public.user_vocabulary (user_id, source_video_id)
  WHERE source_video_id IS NOT NULL;
