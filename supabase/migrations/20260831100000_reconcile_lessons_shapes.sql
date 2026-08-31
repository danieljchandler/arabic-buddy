-- Reconcile the two disjoint shapes of `lessons` (and its satellites).
--
-- History: 20260224000000_curriculum_restructure.sql created `lessons` with
-- the authored-lesson-plan columns (unlock_condition + six JSONB blocks) but
-- no dialect_module/status; 20260321182338 plain-CREATEd the table again with
-- dialect_module/status but none of the authoring columns. Production took the
-- second shape (the first migration never applied there), while a rebuild from
-- migrations takes the first (the second file is a pinned replay failure). No
-- migration produced the union, so `useLessonImport`'s insert — which names
-- columns from both shapes — 400s in production, and the learner-facing
-- lesson-plan sections read `undefined`.
--
-- Every ADD COLUMN below is IF NOT EXISTS so this converges both databases on
-- the union no matter which shape they start from.

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS unlock_condition TEXT,
  ADD COLUMN IF NOT EXISTS lesson_sequence JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS image_scenes JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS flashcard_spec JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS real_world_prompts JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS design_rationale JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sound_spotlight JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dialect_module TEXT NOT NULL DEFAULT 'Gulf',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

-- The same restructure migration added authoring metadata to vocabulary_words;
-- production never got those columns either (the xlsx importer parses them and
-- silently drops them today).
ALTER TABLE public.vocabulary_words
  ADD COLUMN IF NOT EXISTS transliteration TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS image_scene_description TEXT,
  ADD COLUMN IF NOT EXISTS teaching_note TEXT;

-- Production-only columns written by core learner flows (SaveUnknownsBar, the
-- Anki import, TappableArabicText) that no migration ever created — a rebuilt
-- database 400s on "save unknown words" without them. 20260209171143 added
-- sentence_audio_url but never these two.
ALTER TABLE public.user_vocabulary
  ADD COLUMN IF NOT EXISTS sentence_text TEXT,
  ADD COLUMN IF NOT EXISTS sentence_english TEXT;

-- 20260228000000_dialect_validation added this on rebuild only.
ALTER TABLE public.saved_transcriptions
  ADD COLUMN IF NOT EXISTS dialect_validation JSONB;

-- curriculum_chat_approvals: rebuild has approved_at (20260304100000) and no
-- created_at; production has created_at (20260321182338) and no approved_at.
-- Converge on both so neither read direction can break.
ALTER TABLE public.curriculum_chat_approvals
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
