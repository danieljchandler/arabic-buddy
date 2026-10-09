-- The shared asset store: every picture, recording, jingle or line made for a
-- word is made once and kept, for every learner and every later phase of the
-- quiz (docs/quiz-phases-2026-10.md, Phase 2).
--
-- Before this, a My Words picture or jingle was generated per learner onto
-- their own row, so two learners who saved the same word paid twice and
-- nothing could reuse what was made. A generator now looks its word up here
-- first and only generates on a miss; a hit copies the url onto the learner's
-- row exactly as a fresh generation did, so nothing downstream changes.
--
-- The key is the word, not the learner: `concept_key` is the normalised Arabic
-- (the same folding src/lib/arabicWord.ts uses) plus the English sense it was
-- made for, so a homograph does not borrow another word's picture; for a
-- language-neutral kind (an animation of jumping) it is the English concept
-- alone and `dialect` is null. `style_version` is part of the key so a brand
-- refresh regenerates rather than mixes two looks in one deck. The folding
-- lives in supabase/functions/_shared/wordAssets.ts, which every reader and
-- writer goes through.
--
-- Public read: what is in here is the same for everyone and is served from a
-- public bucket anyway. Writes are service-role only, through the word-asset
-- function and the generators, so a learner cannot plant an asset under a key
-- every other learner will be served.
--
-- `kind` is deliberately not a CHECK: a new kind is a new phase, and a CHECK
-- would make each one wait on a migration being applied to the live project.
-- The code holds the list (ASSET_KINDS in _shared/wordAssets.ts).
--
-- Apply this to the live project (Lovable or `supabase db push`); a migration
-- merged through GitHub alone is not applied there. Until it is, every lookup
-- misses and every store fails quietly, so the generators behave exactly as
-- they did before the store existed. See CLAUDE.md.

CREATE TABLE IF NOT EXISTS public.word_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_key text NOT NULL,
  kind text NOT NULL,
  dialect text,
  style_version text NOT NULL,
  url text,
  payload jsonb,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'generated',
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT word_assets_source_check CHECK (source IN ('generated', 'authored', 'reviewed')),
  CONSTRAINT word_assets_has_content CHECK (url IS NOT NULL OR payload IS NOT NULL)
);

-- One asset per word, kind, dialect and style. An expression index rather
-- than NULLS NOT DISTINCT so a language-neutral row (dialect null) is still
-- unique on any Postgres version; writers insert and treat a unique violation
-- as "someone else made it first", so nothing needs ON CONFLICT inference.
CREATE UNIQUE INDEX IF NOT EXISTS word_assets_one_per_key
  ON public.word_assets (concept_key, kind, COALESCE(dialect, ''), style_version);

REVOKE ALL ON public.word_assets FROM anon, authenticated;
GRANT SELECT ON public.word_assets TO anon, authenticated;
GRANT ALL ON public.word_assets TO service_role;

ALTER TABLE public.word_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read word assets"
  ON public.word_assets
  FOR SELECT
  TO anon, authenticated
  USING (true);
