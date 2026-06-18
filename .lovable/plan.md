# Release Readiness — Hakiya (Public Paid Launch + Closed Beta)

Goal: close the gap between today's preview and a state where you can confidently take real money from real users on Gulf, Egyptian, and Yemeni tracks. Work is grouped so you can ship the closed beta first, then flip the paid switch.

---

## 1. Stability & Reliability (must-fix before any external users)

1. **Audit edge function error rates.** Pull last 7 days of `AdminErrors` + `LlmLogs`. Triage anything with >1% error rate or >5s p95. Known suspects: `munsit-tts` (Munsit 429s — already mitigated via serial queue + Azure fallback, verify in logs), `transcribe-*` (RunPod cold starts), `curriculum-chat` (120s ceilings), `discover` ingestion.
2. **Long-running edge functions.** Anything that can exceed 150s (transcription, curriculum generation, lesson import) must use the existing direct-persistence fallback pattern. Verify each one explicitly.
3. **Client crash recovery.** `App.tsx` already persists last-crash + logs via `errorLog`. Add a small admin filter for "errors in last 24h grouped by route" so regressions are visible.
4. **ASR fallback chain.** Confirm Munsit → Soniox → Fanar → Azure → Deepgram still cascades end-to-end after recent changes (manual smoke test per dialect).
5. **TTS concurrency cap.** Already added module-level `munsitChain` semaphore — verify in production that 429s are gone.

## 2. Security & Data (blocker for paid launch)

1. **RLS sweep.** Run `supabase--linter` and fix any `policy_exists_no_rls`, `no_policies`, missing-grant warnings. Public schema tables created without GRANTs will silently break paying users.
2. **Roles.** Confirm `user_roles` + `has_role()` is the only path to admin/recorder/bible_reader checks. Grep for any leftover `profile.is_admin` or `localStorage` role checks.
3. **Edge function auth.** Re-audit `verify_jwt = false` list in `supabase/config.toml`. Each one must be either (a) a public webhook with a shared-secret check, or (b) intentionally public read.
4. **Security scan.** Run the project security scan and fix every critical/high before publishing the paid tier.
5. **Secrets hygiene.** Confirm no API keys are referenced from client code — only `supabase.functions.invoke(...)`.

## 3. Subscriptions & Billing (paid launch only)

`Pricing.tsx`, `useSubscription`, and a `RequireSubscription` gate already exist. Remaining gaps:

1. **Stripe live mode.** Verify products/prices exist for both `standard` and `allin` in live, that `create-checkout` uses live keys, and that `customer-portal` works for cancel/refund.
2. **Webhook coverage.** Confirm a Stripe webhook updates `subscribers` on `customer.subscription.created/updated/deleted` and `invoice.payment_failed`. Without it, refunds and lapsed cards don't down-grade access.
3. **Gating audit.** Walk every premium route through `RequireSubscription`. Compare against the feature matrix in `Pricing.tsx` so the UI promises match enforcement (Discover, Conversation Live Voice, unlimited Tutor Upload, etc.).
4. **Refund/cancel flow.** "Manage subscription" should land in Stripe's customer portal; verify the return URL.
5. **Receipts.** Ensure Stripe is configured to email tax invoices automatically.

## 4. Content Readiness (all three dialects)

For each of Gulf, Egyptian, Yemeni, before flipping its tile from "beta" to "live":

1. **Curriculum coverage:** Stages 1–3 fully populated with vocab + audio + images. Stages 4–6 at minimum have lesson skeletons + Stage-4 vocabulary.
2. **Dialect rule book.** `dialect_rules` table populated with the curated set from `AdminDialectRules` for each dialect. Run a sample of 50 generations through `aiBrain` and check `dialect_rule_violations` is under 5%.
3. **MSA leak detector** changes from previous turn are deployed; verify Egyptian and Gulf no longer false-positive on `كيف`, `البيت`, etc.
4. **Audio:** Every Stage-1/2 word has TTS audio cached. Spot-check 20 words per dialect for native-sounding pronunciation (Munsit Aisha for Gulf, ElevenLabs Hamdan or Azure for Egyptian/Yemeni).
5. **Discover videos:** At least 30 published per dialect with synced subtitles.

## 5. Onboarding & First-Run UX

1. **Placement quiz → personalized path.** End-to-end test for a fresh account in each dialect. Ensure CEFR result actually drives Stage selection on `/index`.
2. **Empty states.** Today, MyWords, Discover, Stories — confirm each renders a useful empty state for a brand-new user.
3. **`MajlisWelcome`** and dialect ritual switcher: copy review for the three live dialects (no "coming soon" badges if all three are launching).
4. **Email confirm flow.** Verify Lovable Cloud auth email template is branded (not the default).

## 6. SEO, Metadata & Sharing

Mostly already done in `index.html` (good title, description, OG, JSON-LD). Remaining:

1. Replace `/favicon.png` with the actual Hakiya icon if it's still the placeholder.
2. Add an OG image (1200x630) — not the favicon — for proper social previews.
3. Sitemap: regenerate `public/sitemap.xml` to include all public routes (placement, pricing, culture-guide, souq-news, learn/* index, dialect-compare, etc.).
4. Set canonical URLs per page via a small head helper for the dynamic routes.
5. `robots.txt` — confirm `/admin` is disallowed.

## 7. Legal & Compliance

1. Review `Terms.tsx` and `Privacy.tsx` for current scope: AI processing, audio recording (microphone use), Stripe billing, third-party processors (Supabase/Lovable Cloud, Munsit, Azure, ElevenLabs, Google Gemini, RunPod, Bright Data, Firecrawl), Bible-reading conditional content.
2. Add a cookie/analytics notice if any analytics is enabled.
3. DMCA + abuse contact email on the Footer.

## 8. Performance & Quality

1. Lighthouse pass on `/`, `/learn`, `/pricing`, `/review` — fix any LCP > 3s or CLS > 0.1.
2. Bundle audit — `App.tsx` already lazy-loads every route, good. Spot-check that no huge dep (e.g. xlsx parser) leaks into the main chunk.
3. Run `bunx vitest run` — fix or quarantine any failing tests before shipping.
4. Mobile sweep at 411×724 (current viewport) for every primary user route.

## 9. Admin & Ops

1. **Admin Dashboard "release health" tile.** Today's error count, error rate, subscriber count, churn delta. Cheap to add and saves you in the first weeks.
2. **Smart notifications.** Ensure `useSmartNotifications` doesn't fire on day 1 for new users (cold-start spam).
3. **Backups.** Confirm Lovable Cloud automatic backups are on for the production instance.

## 10. Launch Mechanics

1. Closed beta first: ship behind a one-time invite code (stored on the profile) so you can throttle inflow. Strip the gate before paid launch.
2. Set up a feedback channel (email, in-app `Send feedback` already?) and surface it from Settings.
3. Stripe in test mode for beta; flip to live only when sections 1–3 are green.
4. Publish — Lovable URL first, then connect custom domain.

---

## Suggested order

```text
Week 1: Section 1 (stability) + Section 2 (security) + Section 4 (content)
Week 2: Section 5 (onboarding) + Section 8 (perf) + Section 9 (admin)
Week 3: Closed beta launch (invite gate, Stripe test)
Week 4: Section 3 (Stripe live) + Section 6/7 (SEO + legal) → public paid launch
```

## What I need from you before I start building

1. Which of the 10 sections do you want me to take on first? (Recommend: 1, 2, 4 in parallel.)
2. Is there an invite-code beta gate already, or should I build it?
3. Confirm the three dialect tracks are all "live" on day one (no "coming soon" gate on any).
4. Any known blockers from your side I should add to Section 1 before I dive in?
