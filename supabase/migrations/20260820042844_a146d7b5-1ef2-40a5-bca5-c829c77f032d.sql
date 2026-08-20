ALTER TABLE public.learner_ai_memory
  ADD COLUMN IF NOT EXISTS turns_total integer NOT NULL DEFAULT 0;

UPDATE public.learner_ai_memory
SET turns_total = turns_seen
WHERE turns_total < turns_seen;

COMMENT ON COLUMN public.learner_ai_memory.turns_seen IS
  'Assistant turns folded into the summary — the mark left by the last rewrite.';
COMMENT ON COLUMN public.learner_ai_memory.turns_total IS
  'Running total of assistant turns for this learner. A rewrite is due once it runs far enough past turns_seen.';