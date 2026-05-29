# Soft Launch — Chunk 1

Goal: knock out the P0 items that make the very first external user's session safe, legal, and cost-controlled. Everything else (analytics, Stripe verification pass, SEO, mobile polish) comes in chunk 2.

## What I'll build

### 1. Logged-out landing experience on `/`
Today `Index.tsx` assumes you're already onboarded. Add a logged-out branch that shows:
- Hero: "Learn real spoken Arabic — Gulf, Egyptian, Yemeni"
- 3 value props (native audio, SRS, real media)
- Primary CTA → `/auth`, secondary → `/placement` (try free)
- Footer with links to `/terms`, `/privacy`, contact email
Logged-in users see the existing Home unchanged.

### 2. Auth hardening
- Call `configure_auth` to enable HIBP leaked-password check
- Call `configure_social_auth` with `["google"]` so Google sign-in works on the live URL
- Verify `Auth.tsx` redirects to `/onboarding` on first sign-in (new profile) and `/` otherwise
- Add a visible "Sign out" entry in Settings (confirm it exists; add if not)

### 3. Security pass
- Run `supabase--linter` and `security--run_security_scan`
- Fix every red item (missing RLS, overly-permissive policy, missing GRANTs)
- I will report findings before applying destructive migrations

### 4. AI cost guardrails
Add per-user daily caps via a new `usage_counters` table + a small `checkUsage(userId, key, limit)` helper. Wire it into the 5 most expensive edge functions:
- `fanar-transcribe` / `munsit-transcribe` / `soniox-transcribe` (transcription) — 10/day free
- `generate-flashcard-image` — 20/day free
- `conversation-practice` — 50 turns/day free
- `curriculum-chat` — 30/day free
- `generate-word-jingle` (Lyria, expensive) — 5/day free

Caps are enforced server-side; returns `429` with a friendly message → client shows a "Daily free limit reached — upgrade" toast linking to `/pricing`. Beta/paid users bypass via `subscriptions` table check.

### 5. Legal stubs + footer
- `/terms` and `/privacy` pages with template content tailored to Lahja (data we store, AI processing, subprocessors: Supabase, OpenAI/Gemini via Lovable, ElevenLabs, Azure, Munsit, RunPod)
- Footer component used on `/`, `/auth`, `/pricing` with: © Lahja, Terms, Privacy, Contact

## Out of scope for this chunk
- Analytics (PostHog) — chunk 2
- Full Stripe end-to-end test pass — chunk 2
- SEO scan + fixes — chunk 2
- Mobile responsive audit — chunk 2
- Error sink to a `client_errors` table — chunk 2

## Deliverable
After approval I'll make the edits, run the linter + security scan, and report back with: items fixed, any findings that need your call, and a checklist of what's left for chunk 2.

Approve and I'll start.
