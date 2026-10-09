-- How a learner wants to be reviewed: 'flashcards' (flip and self-rate, the
-- default) or 'quiz' (questions from the ladder, graded by the app). See
-- src/lib/reviewStyle.ts and src/lib/quizLadder.ts.
--
-- On the profile rather than the device so the choice follows the learner
-- across devices. Client-writable like desired_retention: it changes only how
-- the learner's own cards are presented, never what is written to anyone
-- else's rows. NULL means "never chosen" and reads as the default.
--
-- Apply this to the live project (Lovable or `supabase db push`); a migration
-- merged through GitHub alone is not applied there, and the next types
-- regeneration would drop the column from types.ts. See CLAUDE.md. Until it
-- is applied the feature degrades rather than breaks: the preference stays
-- device-local (the profile write fails quietly and the localStorage cache
-- is the whole preference).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS review_style text
  CHECK (review_style IS NULL OR review_style IN ('flashcards', 'quiz'));
