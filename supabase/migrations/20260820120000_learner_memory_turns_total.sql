-- The tutor's memory needed two counters and only had one.
--
-- `turns_seen` records the turns already folded into the summary — the mark
-- left by the last rewrite. Deciding when the *next* rewrite is due also needs
-- the running total of turns since then, and there was nowhere to keep it: the
-- writer reconstructed it from the messages of the request in hand, which only
-- ever counted the current conversation. A learner who asks one or two
-- questions per session (the case the threshold exists to serve) therefore
-- never reached it, and their memory stayed empty permanently.
--
-- `turns_total` is that running total, advanced on every answered turn.
ALTER TABLE public.learner_ai_memory
  ADD COLUMN IF NOT EXISTS turns_total integer NOT NULL DEFAULT 0;

-- Existing rows have already folded `turns_seen` turns in; starting their
-- running total anywhere lower would make the next rewrite look overdue by a
-- negative amount and never fire.
UPDATE public.learner_ai_memory
SET turns_total = turns_seen
WHERE turns_total < turns_seen;

COMMENT ON COLUMN public.learner_ai_memory.turns_seen IS
  'Assistant turns folded into the summary — the mark left by the last rewrite.';
COMMENT ON COLUMN public.learner_ai_memory.turns_total IS
  'Running total of assistant turns for this learner. A rewrite is due once it runs far enough past turns_seen.';
