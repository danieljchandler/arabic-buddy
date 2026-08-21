DROP POLICY IF EXISTS "Users can insert their own usage rows" ON public.usage_counters;
DROP POLICY IF EXISTS "Users can update their own usage rows" ON public.usage_counters;
REVOKE INSERT, UPDATE, DELETE ON public.usage_counters FROM authenticated, anon;
COMMENT ON TABLE public.usage_counters IS
  'Per-(user, feature, day) AI usage counts backing enforceDailyCap. Read-only to clients: every write goes through increment_usage_counter(), which is SECURITY DEFINER. Never grant INSERT/UPDATE here — a learner who can write this table can reset their own caps.';