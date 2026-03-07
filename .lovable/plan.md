

# Fix: Vite Not Loading Environment Variables

## Root Cause
Vite caches environment variables aggressively. Despite `.env` containing the correct `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, the dev server is serving stale builds where these resolve to `undefined`, causing the Supabase client to fall back to `placeholder.supabase.co`.

## Fix
Make a trivial change to `vite.config.ts` to force a full rebuild (e.g., update the cache-bust comment from `v2` to `v3`). This will force Vite to re-read `.env` and inject the correct values.

Additionally, as a safety measure, update `src/integrations/supabase/client.ts` — **wait, this file is auto-generated and must not be edited.**

Since we cannot edit `client.ts`, the only fix is to force a Vite rebuild by touching `vite.config.ts`. A single comment change will do it.

## Steps
1. Update the comment in `vite.config.ts` from `// cache bust v2` to `// cache bust v3` to force a complete Vite rebuild that re-reads environment variables.

That's it — one line change. No logic changes needed.

