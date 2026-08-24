ALTER FUNCTION public.is_grantable_role(public.app_role) SET search_path TO 'public';

REVOKE EXECUTE ON FUNCTION public.is_grantable_role(public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_grant_role_by_email(text, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_pending_role_grants() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_pending_role(uuid) FROM PUBLIC, anon;