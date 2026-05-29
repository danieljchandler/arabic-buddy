# Soft Launch — Chunk 3

Final pre-launch pass: make the app feel right on a phone, fast on first load, measurable, and welcoming to a brand-new visitor. Picking up the deferred items from chunks 1–2 plus the polish work that decides whether a soft-launch user comes back.

## A. Mobile responsive audit (P0)
Most users will open the soft-launch link on a phone. I'll walk the core flows at 375px and fix what breaks:
1. Landing (`/`), Auth, Pricing, Footer
2. Onboarding / placement quiz
3. Main learn surfaces: lesson player, `MyWordsReview`, `ConversationSimulator`, `Discover`, `Bridge`, `Reading`
4. Settings (incl. new subscription block)
5. App shell nav (bottom-tab vs hamburger on small screens)

Fixes stay in presentation: `max-w-*`, stacking, sticky bars, tap target sizes (≥44px), safe-area insets, keyboard-avoidance on inputs, and the global immersion toggle reachability. No business logic.

## B. Performance & first paint (P1)
- Route-level `React.lazy` + `Suspense` for admin pages, Discover, ConversationSimulator, Reading, Bridge, MemeAnalyzer (heavy + rarely first visit)
- `loading="lazy"` + `decoding="async"` on all `<img>` in vocab/flashcard/discover lists
- Preconnect to Supabase + audio CDN in `index.html`
- Audit bundle: drop any leftover unused deps; verify framer-motion is tree-shaken
- Defer PostHog + ElevenLabs SDK init until after first paint

## C. PostHog analytics (carryover from chunk 2)
Add `posthog-js` lazy-loaded, EU host, init after auth resolved, gated on `VITE_POSTHOG_KEY` (no-op when absent so I can ship without blocking on the key). Events: `signup`, `placement_completed`, `lesson_started`, `lesson_completed`, `review_session_completed`, `subscription_started`, `error_shown`, `cap_hit`. Respect DNT. I'll request the key with `add_secret` mid-chunk; if you don't have one yet, the code ships dormant.

## D. New-user onboarding polish (P0 for retention)
The landing → first "aha" moment is currently rough. I'll tighten:
1. **Landing CTA** routes straight into a 60-second sample lesson (no signup wall) — gate signup at the *end* of the sample, not the start
2. **Post-signup**: skip straight to dialect picker → placement quiz → first lesson; remove any intermediate dashboards
3. **Empty states** on MyWords / Discover / Bridge that explain what to do next instead of showing blank lists
4. **Daily streak nudge** visible on the home surface so day-2 retention has a hook

## E. Launch hygiene
- 404 page with link home
- Consistent loading skeletons (replace any remaining spinners on key surfaces)
- Confirm Footer + legal pages reachable from every authed route
- `<title>` per route via a tiny `useDocumentTitle` hook
- Verify Google sign-in works end-to-end on mobile Safari (popup vs redirect)

## Out of scope
- Bucket lockdown + 429 UI follow-ups (you said leave for now)
- Stripe live test (needs your card walkthrough — separate session)
- Email digest, referral, in-app feedback widget (post-launch P2)
- New features / new dialect modules

## Deliverable
After approval I'll implement A → E in order, ask for the PostHog key when I reach C, and finish with a short report: mobile issues fixed, bundle/route-split before-vs-after, onboarding flow changes, and any blockers left before you flip the switch.

Approve and I'll start.