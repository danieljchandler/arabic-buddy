-- The revision log gains a third machine source: 'resync', the forced-alignment
-- pass that re-times a transcript against the audio (resync-transcript-timing).
-- Like 'ai_resegment', it acts on a reviewer's instruction but is not a native
-- speaker's judgement, and the diff view should be able to say so. Timing
-- changes it makes are logged under the existing 'timing' field.
ALTER TABLE public.transcript_line_revisions
  DROP CONSTRAINT IF EXISTS transcript_line_revisions_source_check;
ALTER TABLE public.transcript_line_revisions
  ADD CONSTRAINT transcript_line_revisions_source_check
  CHECK (source IN ('human', 'ai_retranslate', 'ai_resegment', 'resync'));
