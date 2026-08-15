-- A timestamped record of what is on screen in a video, so the AI tutor can
-- answer "what does that caption say?" and "what's happening at 0:42".
--
-- `extract-visual-context` already samples frames and reads every text overlay
-- with its timing. Until now that result was flattened into `cultural_context`
-- as one prose blob and otherwise left in storage — which meant the tutor
-- could be told a video contains an overlay somewhere, but never which one is
-- on screen right now. This column keeps the timing.
--
-- Shape (array, ordered by start_seconds):
--   [{ "startSeconds": 0, "endSeconds": 5, "text": "POV: طالب في الجامعة",
--      "translation": "POV: a university student", "confidence": "high" }]
--
-- Deliberately not a table. It is written once at ingest, always read whole
-- alongside the row it belongs to, and never queried across videos.
ALTER TABLE public.discover_videos
  ADD COLUMN IF NOT EXISTS visual_timeline jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.discover_videos.visual_timeline IS
  'Timestamped on-screen text and scene notes from extract-visual-context. Read by the Ask AI assistant to ground answers in what is visible at the learner''s current position.';
