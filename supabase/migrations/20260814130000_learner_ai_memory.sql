-- What the AI tutor remembers about a learner between conversations.
--
-- Every other piece of learner context is derived: the SRS state says which
-- words are weak, content history says what they watched. None of it records
-- what they have actually been *asking* — that the same construction has
-- confused them three times, that an explanation by analogy landed where a
-- grammatical one did not, that they keep coming back to the same question in
-- different words. Ask AI opened with a blank slate every session.
--
-- One row per learner per dialect. A learner studying Gulf and Egyptian is two
-- different conversations, and merging them would have the tutor recall a
-- confusion about Egyptian negation while they are working through Gulf.
--
-- Deliberately a summary, not a log. Saved conversations already hold the
-- transcripts; this is the short thing worth carrying into the next session,
-- rewritten as it changes rather than appended to.
CREATE TABLE IF NOT EXISTS public.learner_ai_memory (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  -- Prose, because prose is what goes into the prompt. Length is enforced in
  -- the writer, which is the only thing that ever writes here.
  summary text NOT NULL DEFAULT '',
  -- Questions raised and not yet resolved, so the tutor can pick them back up.
  open_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Assistant turns folded in so far. The writer uses it to decide when the
  -- summary is stale enough to be worth rewriting.
  turns_seen integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dialect)
);

ALTER TABLE public.learner_ai_memory ENABLE ROW LEVEL SECURITY;

-- A learner can read and delete what the tutor remembers about them. Both
-- matter: this is a record of their own confusions, and "forget what I told
-- you" should not require a support ticket.
DROP POLICY IF EXISTS "learners read their own AI memory" ON public.learner_ai_memory;
CREATE POLICY "learners read their own AI memory"
  ON public.learner_ai_memory FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "learners delete their own AI memory" ON public.learner_ai_memory;
CREATE POLICY "learners delete their own AI memory"
  ON public.learner_ai_memory FOR DELETE
  USING (auth.uid() = user_id);

-- Writes are the summarizer's alone. A client-supplied "here is what you
-- remember about me" is a prompt-injection surface with a database behind it,
-- so there is deliberately no INSERT or UPDATE policy for authenticated users.
GRANT ALL ON public.learner_ai_memory TO service_role;
