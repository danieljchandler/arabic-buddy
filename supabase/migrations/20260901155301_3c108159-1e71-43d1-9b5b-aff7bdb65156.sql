-- ID-number logins for people an email invitation never reaches.
CREATE OR REPLACE FUNCTION public.is_access_id_role(_role public.app_role)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _role::text IN ('transcriber', 'content_reviewer')
$$;

CREATE TABLE IF NOT EXISTS public.access_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_id text NOT NULL UNIQUE CHECK (access_id ~ '^[1-9][0-9]{7}$'),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL CHECK (public.is_access_id_role(role)),
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  password_set_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE INDEX IF NOT EXISTS access_credentials_role_idx
  ON public.access_credentials (role, created_at DESC);

ALTER TABLE public.access_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read access credentials" ON public.access_credentials;
CREATE POLICY "Admins read access credentials"
ON public.access_credentials
FOR SELECT
TO authenticated
USING (public.is_admin());

GRANT SELECT ON public.access_credentials TO authenticated;
GRANT ALL ON public.access_credentials TO service_role;
GRANT EXECUTE ON FUNCTION public.is_access_id_role(public.app_role) TO authenticated, service_role;