-- Grant roles by email, including to people who have not signed up yet.
--
-- Two things change here. First, `admin` becomes grantable from the console
-- instead of only from a psql prompt, so the owner can hand out staff access
-- without a database session. Second, a grant no longer requires the account to
-- exist: an address with no user behind it is parked in
-- `pending_role_grants` and applied the moment that address signs up.
--
-- Making `admin` grantable is the part with teeth, so the removal side gets a
-- guard in the same migration: nobody can revoke their own admin row, and the
-- last admin row cannot be revoked at all. Both are enforced in the database
-- rather than in the page, because `user_roles` is writable by any admin under
-- RLS and the page is not the only thing that can reach it.

-- ── Pending grants ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pending_role_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored lowercased and trimmed by the RPC; the index below is what actually
  -- makes the comparison case-insensitive.
  email text NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- One live invitation per address per role. Claimed rows are excluded so the
-- same address can be re-invited later (say, after the role was revoked) while
-- the history of what was claimed stays intact.
CREATE UNIQUE INDEX IF NOT EXISTS pending_role_grants_live_unique
  ON public.pending_role_grants (lower(email), role)
  WHERE claimed_at IS NULL;

CREATE INDEX IF NOT EXISTS pending_role_grants_email_idx
  ON public.pending_role_grants (lower(email))
  WHERE claimed_at IS NULL;

ALTER TABLE public.pending_role_grants ENABLE ROW LEVEL SECURITY;

-- Read-only to admins; every write goes through the security-definer functions
-- below or the signup trigger. An invitation is a claim about who is allowed to
-- become staff, so the same asymmetry the app uses for scores and memories
-- applies: clients may look, only the server may write.
DROP POLICY IF EXISTS "Admins read pending role grants" ON public.pending_role_grants;
CREATE POLICY "Admins read pending role grants"
ON public.pending_role_grants
FOR SELECT
TO authenticated
USING (public.is_admin());

-- ── Which roles the console may hand out ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_grantable_role(_role public.app_role)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _role::text IN (
    'admin',
    'bible_reader',
    'content_reviewer',
    'beta_tester',
    'complimentary',
    'transcriber'
  )
$$;

-- `recorder` is deliberately absent: it is granted alongside a recording setup
-- that happens outside the app, and nothing about this page would make that
-- pairing happen. Keep this list and `MANAGED_ROLES` in `src/lib/rbac.ts` in
-- step — the listing RPC below filters on it and the picker is built from it.

-- ── Guarding the admin role ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_admin_role_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.role::text <> 'admin' THEN
    RETURN OLD;
  END IF;

  -- Only interactive callers are held to this. A service-role job has no
  -- `auth.uid()`, and blocking it would leave admin tooling unable to clean up.
  IF auth.uid() IS NULL THEN
    RETURN OLD;
  END IF;

  -- The account itself is going away. `ON DELETE CASCADE` removes the parent
  -- row first, so by the time this fires there is nothing left to protect —
  -- and without this check, deleting an admin's account fails outright, which
  -- is the guard turning into a bug rather than a safeguard.
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN
    RETURN OLD;
  END IF;

  IF OLD.user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot revoke your own admin role'
      USING ERRCODE = '42501';
  END IF;

  IF (SELECT count(*) FROM public.user_roles WHERE role::text = 'admin') <= 1 THEN
    RAISE EXCEPTION 'The last admin cannot be revoked'
      USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS guard_admin_role_removal ON public.user_roles;
CREATE TRIGGER guard_admin_role_removal
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.guard_admin_role_removal();

-- ── Granting ─────────────────────────────────────────────────────────────────

-- Returns one row describing what happened, because the four outcomes are all
-- normal and the caller has to say something different about each:
--   granted  — the account existed and now holds the role
--   already  — it already held it; nothing written
--   pending  — no account with that address, invitation parked
--   invited  — an identical invitation was already waiting
CREATE OR REPLACE FUNCTION public.admin_grant_role_by_email(
  _identifier text,
  _role public.app_role
)
RETURNS TABLE(status text, user_id uuid, email text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _normalized text := lower(trim(_identifier));
  _found record;
  _existing uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can grant roles' USING ERRCODE = '42501';
  END IF;

  IF _normalized IS NULL OR length(_normalized) = 0 THEN
    RAISE EXCEPTION 'An email address or user id is required' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_grantable_role(_role) THEN
    RAISE EXCEPTION 'Role % cannot be granted from the console', _role
      USING ERRCODE = '42501';
  END IF;

  SELECT u.id, u.email::text INTO _found
  FROM auth.users u
  WHERE (
      _normalized ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND u.id = _normalized::uuid
    )
    OR lower(u.email) = _normalized
  LIMIT 1;

  IF _found.id IS NOT NULL THEN
    SELECT ur.id INTO _existing
    FROM public.user_roles ur
    WHERE ur.user_id = _found.id AND ur.role = _role
    LIMIT 1;

    IF _existing IS NOT NULL THEN
      RETURN QUERY SELECT 'already'::text, _found.id, _found.email;
      RETURN;
    END IF;

    INSERT INTO public.user_roles (user_id, role) VALUES (_found.id, _role);
    RETURN QUERY SELECT 'granted'::text, _found.id, _found.email;
    RETURN;
  END IF;

  -- No account. A UUID that resolves to nobody is a typo, not an invitation —
  -- there is no future signup that would ever match it.
  IF _normalized !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pending_role_grants g
    WHERE lower(g.email) = _normalized AND g.role = _role AND g.claimed_at IS NULL
  ) THEN
    RETURN QUERY SELECT 'invited'::text, NULL::uuid, _normalized;
    RETURN;
  END IF;

  INSERT INTO public.pending_role_grants (email, role, created_by)
  VALUES (_normalized, _role, auth.uid());

  RETURN QUERY SELECT 'pending'::text, NULL::uuid, _normalized;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_pending_role_grants()
RETURNS TABLE(id uuid, email text, role public.app_role, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can list pending role grants' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT g.id, g.email, g.role, g.created_at
  FROM public.pending_role_grants g
  WHERE g.claimed_at IS NULL
  ORDER BY g.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_pending_role(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _deleted int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can revoke pending role grants' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.pending_role_grants
  WHERE id = _id AND claimed_at IS NULL;

  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted > 0;
END;
$$;

-- ── Applying an invitation at signup ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_pending_role_grants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  SELECT NEW.id, g.role
  FROM public.pending_role_grants g
  WHERE lower(g.email) = lower(NEW.email) AND g.claimed_at IS NULL
  ON CONFLICT DO NOTHING;

  UPDATE public.pending_role_grants
  SET claimed_at = now(), claimed_by = NEW.id
  WHERE lower(email) = lower(NEW.email) AND claimed_at IS NULL;

  RETURN NEW;
END;
$$;

-- Its own trigger rather than a line inside `handle_new_user`: a failure here
-- must not be able to stop a profile from being created, and the two run
-- independently.
DROP TRIGGER IF EXISTS on_auth_user_created_apply_roles ON auth.users;
CREATE TRIGGER on_auth_user_created_apply_roles
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.apply_pending_role_grants();

-- ── Listing now includes admin ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_managed_roles()
RETURNS TABLE(id uuid, user_id uuid, role app_role, created_at timestamptz, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can list managed roles' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT ur.id, ur.user_id, ur.role, ur.created_at, u.email::text
  FROM public.user_roles ur
  LEFT JOIN auth.users u ON u.id = ur.user_id
  WHERE public.is_grantable_role(ur.role)
  ORDER BY ur.created_at DESC;
END;
$$;

GRANT SELECT ON public.pending_role_grants TO authenticated;
GRANT ALL ON public.pending_role_grants TO service_role;

REVOKE EXECUTE ON FUNCTION public.apply_pending_role_grants() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_admin_role_removal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_grantable_role(public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_grant_role_by_email(text, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_pending_role_grants() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_pending_role(uuid) TO authenticated, service_role;