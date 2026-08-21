-- usage_counters is the table every AI daily cap counts against. Writes to it
-- must only ever come from increment_usage_counter(), the SECURITY DEFINER
-- function that owns the accounting; a learner able to write their own row
-- can PATCH the count back to zero over PostgREST and reset every free-tier
-- cap in the app.
--
-- Two owner-write policies were added alongside the counter and have been
-- inert ever since, because the table only carries GRANT SELECT TO
-- authenticated — PostgREST refuses the write before a policy is ever
-- consulted. That makes them a trap rather than a hole: they read as intent
-- to allow client writes, so the day someone adds `GRANT INSERT, UPDATE ...
-- TO authenticated` to fix an unrelated problem, the cap system quietly stops
-- working and nothing fails loudly enough to notice.
--
-- Dropping them states the actual rule in the place that enforces it.
DROP POLICY IF EXISTS "Users can insert their own usage rows" ON public.usage_counters;
DROP POLICY IF EXISTS "Users can update their own usage rows" ON public.usage_counters;

-- And make the grant itself explicit rather than merely absent, so a broad
-- `GRANT ALL ... TO authenticated` elsewhere cannot widen it by accident.
REVOKE INSERT, UPDATE, DELETE ON public.usage_counters FROM authenticated, anon;

COMMENT ON TABLE public.usage_counters IS
  'Per-(user, feature, day) AI usage counts backing enforceDailyCap. '
  'Read-only to clients: every write goes through increment_usage_counter(), '
  'which is SECURITY DEFINER. Never grant INSERT/UPDATE here — a learner who '
  'can write this table can reset their own caps.';
