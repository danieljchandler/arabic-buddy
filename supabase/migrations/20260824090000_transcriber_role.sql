-- The `transcriber` role: a native speaker who checks the AI's transcriptions
-- and translations, and nothing else. Deliberately *not* an admin — a
-- transcriber can correct Arabic, fix a translation, and annotate a video, but
-- cannot publish one, touch billing, or hand out roles.
--
-- Alone in its own migration on purpose: Postgres refuses to use a new enum
-- value in the same transaction that added it, and every other object here
-- wants to name it. See 20260824090100_transcript_review.sql for the rest.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'transcriber';
