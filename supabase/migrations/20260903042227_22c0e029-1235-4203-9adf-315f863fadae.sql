-- Grants the 20260902 migrations left out. This file was originally a
-- dashboard export that re-ran all seven of them wholesale; the tables,
-- triggers and policies already exist by this point in the history, so only
-- the four statements that were actually new remain. GRANT is idempotent.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_perception_progress TO authenticated;
GRANT ALL ON public.user_perception_progress TO service_role;

GRANT SELECT, INSERT ON public.placement_results TO authenticated;
GRANT ALL ON public.placement_results TO service_role;
