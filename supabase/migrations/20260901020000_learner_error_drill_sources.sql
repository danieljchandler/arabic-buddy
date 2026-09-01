-- Two new learner_errors sources for the plateau feature set:
--
--   mistake_drill — the fossilization drills on /mistakes. Fossilized errors
--   persist precisely because they rarely impede communication enough to get
--   corrected (docs/plateau-research-2026-09.md §1), so these drills target
--   the learner's own unresolved errors head-on; a clean production there is
--   what resolves them.
--
--   monologue — the monologue feature's future content feedback (plan Phase
--   2d), reserved now so the next writer doesn't need another migration.
--
-- Same drop-and-recreate shape as 20260812210000_writing_source.sql, and for
-- the same reason: the constraint exists under different auto-generated names
-- depending on which migration path a database came up through.

ALTER TABLE public.learner_errors
  DROP CONSTRAINT IF EXISTS learner_errors_source_check;
ALTER TABLE public.learner_errors
  ADD CONSTRAINT learner_errors_source_check
  CHECK (source IN (
    'pronunciation', 'shadow', 'sentence_coach', 'set_phrase_voice', 'quiz',
    'writing', 'monologue', 'mistake_drill'
  ));
