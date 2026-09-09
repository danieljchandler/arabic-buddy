ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS source_key TEXT,
  ADD COLUMN IF NOT EXISTS can_do JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS grammar_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS culture_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dialogue JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS lessons_source_key_key
  ON public.lessons (source_key);

ALTER TABLE public.lessons DROP CONSTRAINT IF EXISTS lessons_stage_id_lesson_number_key;

ALTER TABLE public.vocabulary_words
  ADD COLUMN IF NOT EXISTS example_arabic TEXT,
  ADD COLUMN IF NOT EXISTS example_transliteration TEXT,
  ADD COLUMN IF NOT EXISTS example_english TEXT;

COMMENT ON COLUMN public.lessons.source_key IS
  'curriculum/tracks lesson identity (<dialect>/s<stage>/l<nn>); NULL for lessons authored in the admin UI or imported from xlsx.';