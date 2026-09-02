-- learner_errors sources for open conversation (docs/language-learning-plan-
-- 2026-09.md, Phase 1).
--
-- Six scoring functions recorded learner errors; the two surfaces where a
-- learner produces the most Arabic — the free-chat tutor and the realtime
-- voice tutor — recorded none, so the richest source of production fed
-- nothing into the mistake drill. Both now go through extract-learner-errors:
--
--   conversation  the text tutor (free-chat), triggered only when the reply
--                 carried a [[CORRECTION]] line — the assistant's own judgement
--                 that something was wrong, not a second guess over every turn.
--   voice         the realtime voice tutor. Flag-gated on the client: dialect
--                 ASR runs at 60%+ WER, so a "voice error" is as likely to be
--                 the transcriber's as the learner's. detail.asr_provider says
--                 which engine heard it.
--
-- Same drop-and-recreate shape as 20260901040000_chunk_coach_source.sql, for
-- the same auto-generated-constraint-name reason.
ALTER TABLE public.learner_errors
  DROP CONSTRAINT IF EXISTS learner_errors_source_check;
ALTER TABLE public.learner_errors
  ADD CONSTRAINT learner_errors_source_check
  CHECK (source IN (
    'pronunciation', 'shadow', 'sentence_coach', 'set_phrase_voice', 'quiz',
    'writing', 'monologue', 'mistake_drill', 'chunk_coach',
    'conversation', 'voice'
  ));
