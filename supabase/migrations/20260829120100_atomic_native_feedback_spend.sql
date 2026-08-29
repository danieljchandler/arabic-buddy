-- Spending a native-feedback credit becomes one atomic decision.
--
-- The edge function read the balance, created the request, then appended a
-- `-1` row. Three statements, no lock: N concurrent submits all read the same
-- balance, all pass the `balance < 1` test, and all get their request queued.
-- One credit, N pieces of work — and the work is a native speaker's time, so
-- the overdraft is a real cost rather than a counter being wrong.
--
-- The ledger is append-only rows, so there is no row to lock and `FOR UPDATE`
-- has nothing to hold. A transaction-scoped advisory lock keyed on the user is
-- the smallest thing that serialises just the spends for one learner, and it
-- releases on commit or rollback without any cleanup path to forget.

CREATE OR REPLACE FUNCTION public.spend_native_feedback_credit(
  _user_id uuid,
  _reason text DEFAULT 'submit'
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _balance integer;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'a user id is required' USING ERRCODE = '22023';
  END IF;

  -- Serialise concurrent spends for this learner only. Held to end of
  -- transaction; other learners are unaffected.
  PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text, 0));

  SELECT COALESCE(sum(delta), 0) INTO _balance
  FROM public.native_feedback_credits
  WHERE user_id = _user_id;

  -- NULL rather than an exception: "no credits" is an ordinary answer the
  -- caller turns into a 402, not a failure.
  IF _balance < 1 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.native_feedback_credits (user_id, delta, reason)
  VALUES (_user_id, -1, _reason);

  RETURN _balance - 1;
END;
$$;

-- Same asymmetry as the rest of the ledger: clients read their own rows under
-- RLS, only the server may move the balance.
REVOKE ALL ON FUNCTION public.spend_native_feedback_credit(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_native_feedback_credit(uuid, text) TO service_role;
