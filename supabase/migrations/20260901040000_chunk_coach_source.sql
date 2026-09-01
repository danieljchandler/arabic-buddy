-- learner_errors source for the chunk-in-situation coach (plan Phase 4a):
-- free-form spoken answers to a set-phrase scenario, judged on whether the
-- chunk was used naturally. Same drop-and-recreate shape as the previous
-- source additions, for the same auto-generated-constraint-name reason.

ALTER TABLE public.learner_errors
  DROP CONSTRAINT IF EXISTS learner_errors_source_check;
ALTER TABLE public.learner_errors
  ADD CONSTRAINT learner_errors_source_check
  CHECK (source IN (
    'pronunciation', 'shadow', 'sentence_coach', 'set_phrase_voice', 'quiz',
    'writing', 'monologue', 'mistake_drill', 'chunk_coach'
  ));
