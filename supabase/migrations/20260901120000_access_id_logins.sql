-- ID-number logins for people an email invitation never reaches.
--
-- The existing way to bring in a native-speaker reviewer is to grant a role to
-- an email address and wait for that address to sign up. When the person on the
-- other end has no inbox they check, or never completes a signup form written
-- in a language they do not read, the grant sits in `pending_role_grants`
-- forever and the reviewer never arrives. This is the second door: an admin
-- mints an ID number and a password, sends both over whatever channel already
-- works, and the reviewer signs in with those.
--
-- Underneath it is an ordinary Supabase account whose address is
-- `<id>@ids.hakiya.app` — a domain with no MX record, so the account has no
-- inbox and no self-service password reset. Everything downstream (sessions,
-- `user_roles`, RLS, the transcript audit trail) therefore keeps working
-- untouched; this table is only the registry that says which accounts are these
-- and who minted them.
--
-- What is deliberately NOT here: the password. It is displayed once, at the
-- moment it is minted, and never stored in any recoverable form — the account
-- has an ordinary Supabase password hash and nothing else. An admin who loses
-- it resets it, which mints a new one. A table an admin could read passwords
-- out of would be a strictly worse thing to have than the reset button.

-- ── Which roles may be handed out this way ───────────────────────────────────

-- Narrower than `is_grantable_role`, and for a different reason. That function
-- asks "may the console hand this out at all"; this one asks "may this be a
-- password credential minted by someone else and sent over a chat app". An
-- outside contributor whose whole job is one page, yes. Anything carrying
-- spending, billing or the console itself, no — and `admin` above all, since an
-- admin who cannot receive email cannot be verified as themselves.
--
-- Kept in step with ACCESS_ID_ROLES in
-- `supabase/functions/_shared/accessCodeCore.ts`, which is what the UI builds
-- its picker from; this is what actually refuses the write.
CREATE OR REPLACE FUNCTION public.is_access_id_role(_role public.app_role)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _role::text IN ('transcriber', 'content_reviewer')
$$;

-- ── The registry ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.access_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The digits themselves, so the console can list and search by what the
  -- holder was actually told. The address in `auth.users` is derived from this
  -- and not the other way round.
  access_id text NOT NULL UNIQUE CHECK (access_id ~ '^[1-9][0-9]{7}$'),
  -- One credential per account: re-minting for the same person creates a new
  -- account rather than silently repointing an existing one, so the audit
  -- trail on `transcript_line_revisions` never has two meanings for one id.
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL CHECK (public.is_access_id_role(role)),
  -- Who this is, in the admin's words. The account has no name of its own —
  -- an ID number and nothing else is unusable a month later.
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- When the current password was minted. Not the password, and not a hash of
  -- it: enough to answer "is the one I sent still the live one?".
  password_set_at timestamptz NOT NULL DEFAULT now(),
  -- Set when access is switched off. The row stays: deleting it would delete
  -- the record that this ID ever existed, and the revisions it signed remain.
  disabled_at timestamptz
);

CREATE INDEX IF NOT EXISTS access_credentials_role_idx
  ON public.access_credentials (role, created_at DESC);

ALTER TABLE public.access_credentials ENABLE ROW LEVEL SECURITY;

-- Admins read; nobody writes from a client. The same asymmetry the app already
-- uses for scores, memories and transcript reviews, and for the same reason:
-- this table decides who is staff, so a client that could write it could make
-- itself staff. Every write goes through the `access-credentials` edge function
-- under the service role.
DROP POLICY IF EXISTS "Admins read access credentials" ON public.access_credentials;
CREATE POLICY "Admins read access credentials"
ON public.access_credentials
FOR SELECT
TO authenticated
USING (public.is_admin());

GRANT SELECT ON public.access_credentials TO authenticated;
GRANT ALL ON public.access_credentials TO service_role;
GRANT EXECUTE ON FUNCTION public.is_access_id_role(public.app_role) TO authenticated, service_role;
