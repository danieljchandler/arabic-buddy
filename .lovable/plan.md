# Soft Launch — Chunk 2

Goal: ship the remaining P0/P1 items so a public link is safe, observable, monetizable, and discoverable. Includes the two follow-ups from chunk 1 (bucket lockdown + 429 UI).

## What I'll build

### A. Carryover from chunk 1
1. **Storage bucket lockdown** — 6 public buckets (`avatars`, `meme-uploads`, `flashcard-images`, `flashcard-audio`, `tutor-audio-clips`, `audio`) currently allow filename enumeration. Keep public READ (we serve images/audio by URL) but add explicit RLS policies on `storage.objects` so:
   - `avatars`: anyone can read, only owner (path starts with `auth.uid()`) can write/update/delete
   - `meme-uploads`, `tutor-audio-clips`: owner-scoped write, public read
   - `flashcard-images`, `flashcard-audio`, `audio`: admin-only write, public read
   Removes ability for any signed-in user to overwrite/delete others' files.
2. **429 UI hook** — `useUsageCap` hook + `handleCapResponse(res)` helper. Single global toast: "Daily free limit reached — upgrade for unlimited" with action button → `/pricing`. Wire into the 5 capped edge function call sites.

### B. Error visibility (P0 #5)
3. **Client error sink** — New `client_errors` table (user_id nullable, route, message, stack, user_agent, created_at). `logClientError()` util called from `ErrorBoundary` and unhandled promise/window error listeners in `main.tsx`. Rate-limited client-side (max 10/min/session). Admin page `/admin/errors` lists last 200 with filters.
4. **Edge function error sink** — `_shared/logError.ts` writes to same table from catch blocks in the 5 capped functions + the existing transcription pipeline.

### C. Analytics (P1 #7)
5. **PostHog** — Add `posthog-js` (lazy-loaded, EU host). Init only after auth resolved. Track: `signup`, `placement_completed`, `lesson_started`, `lesson_completed`, `review_session_completed`, `subscription_started`, `error_shown`. Respect DNT. Requires `VITE_POSTHOG_KEY` — I'll add via `add_secret` and gate init behind its presence so missing key = no-op.

### D. Stripe verification (P0 #3)
6. **End-to-end test pass** — I'll walk the existing `/pricing` → checkout → `subscriptions` table update flow, confirm webhook (or polling) updates `subscriptions.status`, and that `useSubscription` reflects it. Fix whatever is broken. No new payment surface — just make the existing one reliable. Includes a "Manage subscription" link in Settings calling `customer-portal`.

### E. SEO (P1 #9)
7. Run `seo_chat--trigger_scan`, then fix the failing items in `index.html` (title, description, canonical, og:*, JSON-LD for `SoftwareApplication`), `robots.txt`, and `sitemap.xml`. Mark fixed via `update_findings`.

## Out of scope for this chunk
- Mobile responsive audit (manual pass — chunk 3)
- Lighthouse perf budget work beyond what falls out of lazy-loading
- Referral, in-app feedback widget, email digest, status page (P2)

## Deliverable
After approval I'll implement A → E in order, ask for the PostHog key when I reach C, and finish with a short report: which 429s now show the upgrade toast, what the SEO scan found and fixed, and any Stripe gaps that need your call (e.g. webhook endpoint configuration).

Approve and I'll start.
