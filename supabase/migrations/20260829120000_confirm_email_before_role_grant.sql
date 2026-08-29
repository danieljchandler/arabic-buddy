-- Pending role grants are claimed on a *confirmed* address, not a typed one.
--
-- `apply_pending_role_grants` fired on `AFTER INSERT ON auth.users` and matched
-- on the email string alone. At INSERT time `email_confirmed_at` is always
-- null — nobody has proved anything yet — so signing up with an invited
-- address was enough to be handed the role it was invited to, and `admin` is
-- one of the grantable roles. Worse, the same statement marked the invitation
-- `claimed`, so the person it was actually meant for silently got nothing and
-- the real admin had no signal that anything had gone wrong.
--
-- Whether that was reachable depended on the project's "Confirm email" auth
-- setting, which lives in the dashboard and not in this repo. A guard that
-- holds only while a dashboard toggle stays flipped is not a guard.
--
-- The claim now happens when the address is confirmed:
--   * INSERT with an already-confirmed address (OAuth, admin-created users) —
--     the provider has vouched for it, so claim immediately.
--   * UPDATE where `email_confirmed_at` goes from null to set — the ordinary
--     email/password path, claimed at the moment the link is clicked.
--
-- Re-running the same logic on both is safe: `ON CONFLICT DO NOTHING` on the
-- insert and `claimed_at IS NULL` on the update make the second run a no-op.

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

  -- An unconfirmed address is a claim about who someone is, not evidence.
  IF NEW.email_confirmed_at IS NULL THEN
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

REVOKE EXECUTE ON FUNCTION public.apply_pending_role_grants() FROM PUBLIC, anon, authenticated;

-- The INSERT trigger stays, for accounts that arrive already confirmed; the
-- function above now no-ops for the rest.
DROP TRIGGER IF EXISTS on_auth_user_created_apply_roles ON auth.users;
CREATE TRIGGER on_auth_user_created_apply_roles
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.apply_pending_role_grants();

-- …and the confirmation itself is the other, and now usual, moment to claim.
-- Narrowed with a WHEN clause so this does not run on every unrelated update
-- to an auth.users row.
DROP TRIGGER IF EXISTS on_auth_user_confirmed_apply_roles ON auth.users;
CREATE TRIGGER on_auth_user_confirmed_apply_roles
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.apply_pending_role_grants();
