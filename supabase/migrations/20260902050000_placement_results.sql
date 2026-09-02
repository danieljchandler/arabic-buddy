-- Placement history (docs/language-learning-plan-2026-09.md, Phase 6a).
--
-- profiles carries one placement level per dialect and overwrites it each
-- time, so the app has never been able to show a learner their level over
-- time — it reports activity (XP, streaks, minutes) but no proficiency. This
-- keeps every placement, so LearningAnalytics can draw the line and the
-- daily queue can ask for a re-check once enough reviews have passed.
--
-- Client-writable, like the profile columns it mirrors: the placement quiz
-- is self-administered and there is nothing to gain by inflating it. Append
-- only from the client (no UPDATE/DELETE policies) so a past result cannot
-- be rewritten.

CREATE TABLE public.placement_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dialect text NOT NULL DEFAULT 'Gulf',
  cefr_level text NOT NULL,
  confidence numeric,
  strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  weaknesses jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- How many rated reviews the learner had in review_log at the time, so a
  -- later level can be read against the practice that preceded it.
  reviews_at_time integer,
  taken_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_placement_results_user
  ON public.placement_results (user_id, dialect, taken_at DESC);

ALTER TABLE public.placement_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own placement results" ON public.placement_results
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own placement results" ON public.placement_results
  FOR INSERT WITH CHECK (auth.uid() = user_id);
