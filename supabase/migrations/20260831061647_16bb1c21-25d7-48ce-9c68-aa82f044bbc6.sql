ALTER TABLE public.transcript_line_revisions
  DROP CONSTRAINT IF EXISTS transcript_line_revisions_source_check;
ALTER TABLE public.transcript_line_revisions
  ADD CONSTRAINT transcript_line_revisions_source_check
  CHECK (source IN ('human', 'ai_retranslate', 'ai_resegment', 'resync'));