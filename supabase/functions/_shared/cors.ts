/**
 * CORS headers for Supabase Edge Functions.
 *
 * In production, set the ALLOWED_ORIGINS secret (comma-separated) to restrict
 * which origins may call your functions.  When the variable is not set the
 * default is to allow only the known production domain.
 */
const DEFAULT_ORIGINS = 'https://lahja-arabic.lovable.app';

function getAllowedOrigins(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS') ?? DEFAULT_ORIGINS;
  return raw.split(',').map(o => o.trim()).filter(Boolean);
}

/**
 * Return CORS headers that mirror the request's Origin header only when it
 * matches the allow-list.  For unknown origins the Access-Control-Allow-Origin
 * header is omitted so browsers will block the response.
 */
export function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers?.get('origin') ?? '';
  const allowed = getAllowedOrigins();

  // During local development (localhost / 127.0.0.1) always allow
  const isLocal = origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');
  const matchedOrigin = allowed.includes(origin) || isLocal ? origin : '';

  return {
    ...(matchedOrigin ? { 'Access-Control-Allow-Origin': matchedOrigin } : {}),
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
    'Vary': 'Origin',
  };
}

/**
 * Legacy constant kept for backward compatibility with functions that haven't
 * been migrated to getCorsHeaders() yet.
 *
 * @deprecated Use getCorsHeaders(req) instead.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};