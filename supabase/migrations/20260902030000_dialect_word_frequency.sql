-- Dialect word frequency, derived from the app's own transcripts
-- (docs/language-learning-plan-2026-09.md, Phase 3).
--
-- No frequency list for spoken Gulf, Egyptian or Yemeni Arabic exists
-- anywhere (research §4, §10), and MSA frequency ranks the wrong words for a
-- dialect learner. The only source of genuine dialect frequency this project
-- has is what it has transcribed: caption lines scored for dialectness and
-- transcripts native reviewers have corrected. derive-word-frequency counts
-- those nightly into this table and stamps a rank on the vocabulary and
-- set-phrase entries it can match, so new cards can be admitted common-first
-- (reviewOrder.ts) — the retrieval-practice gain was driven by high-frequency
-- words (research §1).
--
-- Written only by the edge function under the service role; readable by
-- anyone signed in, since there is nothing personal in a word count.

CREATE TABLE public.dialect_word_frequency (
  dialect text NOT NULL,
  token text NOT NULL,
  -- Weighted: reviewed transcript lines count for more than raw captions.
  count numeric NOT NULL DEFAULT 0,
  -- Distinct source videos the token appears in, unweighted.
  doc_count integer NOT NULL DEFAULT 0,
  -- log10 of frequency per billion tokens; ~7 is "the", ~3 is rare.
  zipf numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dialect, token)
);

CREATE INDEX idx_dialect_word_frequency_rank
  ON public.dialect_word_frequency (dialect, count DESC);

GRANT SELECT ON public.dialect_word_frequency TO authenticated;
GRANT ALL ON public.dialect_word_frequency TO service_role;

ALTER TABLE public.dialect_word_frequency ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read word frequency"
  ON public.dialect_word_frequency
  FOR SELECT
  TO authenticated
  USING (true);

-- 1 = most frequent in the dialect's corpus; NULL = never seen there. NULL is
-- information ("nobody on our channels says this"), not a gap to fill with a
-- guess, and new-card ordering sorts it last.
ALTER TABLE public.vocabulary_words
  ADD COLUMN IF NOT EXISTS frequency_rank integer;
ALTER TABLE public.set_phrases
  ADD COLUMN IF NOT EXISTS frequency_rank integer;
