// Fire-and-forget logger that records MSA leaks into `dialect_rule_violations`.
// Never throws. Uses service-role client so it works from public edge functions too.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import type { Dialect } from './dialectHelpers.ts';
import type { MsaLeakResult } from './msaLeakDetector.ts';

interface LogArgs {
  dialect: Dialect;
  leaks: MsaLeakResult;
  offendingText: string;
  sourceFunction: string;
  metadata?: Record<string, unknown>;
}

let cached: ReturnType<typeof createClient> | null = null;
function client() {
  if (cached) return cached;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export function logMsaViolations(args: LogArgs): void {
  try {
    if (!args.leaks?.leaks?.length) return;
    const sb = client();
    if (!sb) return;

    const snippet = (args.offendingText ?? '').slice(0, 2000);
    const rows = args.leaks.leaks.slice(0, 20).map((token) => ({
      dialect: args.dialect,
      offending_text: snippet,
      msa_token: token,
      detected_by: 'msa_leak_detector',
      source_function: args.sourceFunction,
      metadata: {
        severity: args.leaks.severity,
        ...(args.metadata ?? {}),
      },
    }));

    // Fire-and-forget; swallow any error.
    sb.from('dialect_rule_violations').insert(rows as any).then(
      ({ error }) => {
        if (error) console.warn('[msaViolationLogger] insert failed:', error.message);
      },
      (err) => console.warn('[msaViolationLogger] insert threw:', err),
    );
  } catch (err) {
    console.warn('[msaViolationLogger] unexpected error:', err);
  }
}
