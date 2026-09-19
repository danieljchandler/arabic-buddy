ALTER TABLE public.transcript_line_revisions
  DROP CONSTRAINT IF EXISTS transcript_line_revisions_field_check;

ALTER TABLE public.transcript_line_revisions
  ADD CONSTRAINT transcript_line_revisions_field_check CHECK (field IN (
    'arabic', 'translation', 'literal', 'timing', 'structure',
    'cultural_context', 'grammar_points', 'vocabulary',
    'dialect', 'dialect_subvariety', 'dialect_features',
    'title', 'title_arabic'
  ));