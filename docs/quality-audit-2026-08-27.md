# App quality audit — 2026-08-27

Pre-investor-demo sweep. Findings only — nothing here has been fixed yet.

**How this was gathered:** every CI check run locally (typecheck, lint ratchet,
5,738 unit tests, production build, all 2,061 Playwright e2e tests, Deno edge
typecheck + 1,715 runtime tests, CI history on GitHub), four parallel code
audits (error paths, UX flows, edge functions, unfinished work), and a
screenshot walkthrough of all 80 learner routes (desktop/mobile,
signed-in/anonymous) against the hermetic backend.

## The one-paragraph verdict

The app's core is in better shape than most at this stage — typecheck, lint,
unit and e2e suites are all green, error boundaries and CORS/cap contract
tests exist, and the landing page, /today dashboard and navigation look
genuinely polished. The risks are concentrated in five places: **CI on main
has been red for a week** (so nothing is currently gating merges), **a handful
of demo-killer runtime behaviours** (daily caps on the demo account, an
infinite paid-API retry loop, a mic failure with zero feedback, outages that
render as "no content"), **a broken onboarding funnel for Google sign-ups**,
**systemic raw error strings in learner-facing toasts**, and **pricing copy
that promises features the code does not implement** — the last one is
exactly what an investor doing product diligence will find.

---

## A. CI on main is red — and has been since ~Aug 21

Every push to main since Aug 21 has a failing CI run. Two jobs fail; both are
test/infra drift rather than product breakage, but while they stay red, CI
catches nothing new.

- **A1. Edge runtime tests: 14 failures.** 13 are `edit-story-scene-image`
  (`supabase/functions/_test/story_media_test.ts:400-579`): the function was
  rewritten to read `user_roles` directly (a genuine prod fix — the old
  `can_manage_content` RPC 403'd for everyone), but the tests still stub the
  old RPC and never seed `user_roles`, so every test now gets 403. The 14th is
  `learner_memory_test.ts:109`: `EMPTY_MEMORY` gained a `turnsTotal: 0` field
  and one assertion was never updated. Reproduced locally on CI's pinned Deno
  2.9.5 — identical 14 failures.
- **A2. Migration replay: 10 new migrations cannot rebuild a database from
  scratch** (relation/policy "already exists"): `20260811160418`,
  `20260812124520`, `20260812140000_flywheel_learner_loop`,
  `20260812180000_referrals`, `20260812190000_native_feedback`,
  `20260812200000_placement_history`, `20260812210000_daily_story_sentences`,
  `20260823141341`, `20260823141638`, `20260824090206`. Production is fine
  (it already has the objects), but the repo's migration history is no longer
  a rebuildable source of truth, and the drift guard flags these as new,
  unpinned failures.

Everything else is green locally: typecheck, lint ratchet (533/533), 5,738
unit tests, production build, `deno check`, and 2,060/2,061 e2e tests (the
one failure, `admin-bible-lessons.spec.ts:282`, passes in isolation — a
timeout flake under load).

---

## B. Demo-killers (fix before anyone screens the app live)

- **B1. Free-tier daily caps will cut the demo off mid-flight.**
  `supabase/functions/_shared/usageCap.ts:213-292`. Tightest caps:
  `generate-daily-story` 5/day, `generate-story` and `writing-coach` 10/day,
  `reading-passage`/`listening-quiz`/`suggest-flashcards` 15/day,
  `how-do-i-say`/`phrase-of-the-day`/`grammar-drill`/`daily-challenge` 20/day,
  plus a monthly voice-minutes budget. A morning of rehearsal on a free demo
  account exhausts several; investors then see 429 "upgrade to continue"
  toasts. The escape hatch already exists: the `complimentary` (or `admin`)
  role is treated as unlimited (`usageCap.ts:63-74`) — **verify the demo
  account has it before the demo.**
- **B2. Word-tap translation retries forever on failure.**
  `src/components/transcript/LineByLineTranscript.tsx:109-140` (verified): if
  `translate-phrase` fails, `liveTranslation` stays null, `isTranslating`
  flips back to false, and the auto-translate effect immediately re-fires —
  an infinite request loop against a paid model endpoint for as long as the
  word popover is open, with the learner seeing a translation that never
  arrives. This is the core Discover-video interaction.
- **B3. Denied microphone = dead button, no feedback.**
  `src/pages/PronunciationPractice.tsx:159-161` (verified): getUserMedia
  failure is `console.error` only. On a fresh browser profile (i.e. a demo
  machine) tapping record does nothing visible. `ConversationSimulator` and
  `SetPhrasesPractice` already show a "Microphone blocked" toast — this page
  forgot.
- **B4. Outages render as "no content", not as errors.**
  - Home feed: `src/pages/Feed.tsx:65,229-245` never reads the query's error;
    a transient failure shows "No new clips right now — upload a clip" on the
    front door.
  - Flashcard review: `src/pages/Review.tsx:50,268` — a failed due-cards fetch
    renders "All caught up!", a false success on the app's central loop.
  - Same pattern on `Curriculum.tsx:59-99`, `Stories.tsx:21-36`.
- **B5. Upgrade/Subscribe can silently do nothing.**
  `src/hooks/useSubscription.ts:119-147` — `window.open(url, '_blank')` runs
  after an `await`, outside the click gesture; Safari and popup-blocking
  Chrome block it, and the return value is never checked. The pricing page's
  subscribe button then appears dead. Same pattern in `NativeFeedback.tsx:104`.
- **B6. Paid credit purchase can vanish silently.**
  `src/pages/NativeFeedback.tsx:63-74` — the post-Stripe confirm call ignores
  `error`, then strips the retry token from the URL. A user who paid can end
  up with no credits, no error, and no way to retry.

---

## C. Onboarding funnel breaks (highest-leverage UX fixes)

- **C1. Google sign-ups never see onboarding.** The gate lives only on
  `/auth` (`src/pages/Auth.tsx:51-68`) and `/today` (`Index.tsx:136-155`);
  Google OAuth redirects to `/` (the feed), which never checks
  `onboarding_completed`. A new Google user gets no dialect/level/goal setup
  and no tour. Google sign-up also bypasses the closed-beta invite-code check
  that email signup enforces (`Auth.tsx:344-360` vs `:100-152`) — confirm
  whether that's intentional.
- **C2. The placement quiz tests the wrong dialect.** Onboarding writes the
  chosen dialect to the profile but never calls `DialectContext.setDialect`
  (`Onboarding.tsx:73,120-124`; context syncs from profile only on app mount,
  `DialectContext.tsx:72-92`). Pick Egyptian → "Take the Placement Quiz" →
  quizzed in Gulf, saved as `placement_level_gulf`
  (`PlacementQuiz.tsx:120,148,244-249`). Completing onboarding has the same
  problem: the feed/curriculum stay on the localStorage default ("Gulf")
  until a full reload.
- **C3. Jumping to the placement quiz abandons the wizard.**
  `Onboarding.tsx:296-306` navigates away from step 3; wizard state is local
  and lost, `onboarding_completed` stays false, and after the quiz the user
  lands on the feed half-onboarded (next /today visit restarts onboarding
  from step 1).
- **C4. Anonymous placement results are discarded.** The landing page CTA
  invites visitors to the quiz; after 20 questions,
  `PlacementQuiz.tsx:238-241` silently drops the results and returns them to
  the landing page — no "sign up to keep your level".
- **C5. Placement quiz can dead-end mid-run.** `PlacementQuiz.tsx:224-233` —
  a failed batch fetch leaves the learner stuck on the last answered
  question; re-answering appends duplicate history and the quiz never
  completes.

---

## D. Systemic raw error strings in learner toasts

- **D1. `"Edge Function returned a non-2xx status code"`** — supabase-js's
  literal `FunctionsHttpError` message — is what learners see whenever an
  edge call fails in: Translate (`useTranslateText.ts:31,39`), GrammarDrills
  (`:175,183`), PlacementQuiz (`:151,157`), SetPhrasesPractice (`:50,117`),
  Listen (`:84`) / ListenEpisode (`:91,129`), DailyStory (`:211`), BattlePlay
  (`:105`), DiscoverVideo grammar notes (`:508,516`), ConversationSimulator
  voice (`:225,234`), BibleReading (`:286,323`), Transcribe
  (`:506,631,991,1050`), MemeAnalyzer (`:249,267`), and pronunciation via
  `useAzurePronunciation.ts:166-175`. The good pattern already exists in the
  repo (`HowDoISay.tsx:63-76` reads the response body) but only two pages
  use it.
- **D2. Daily-cap 429s mostly don't upsell.** `lib/handleCapResponse.ts`
  produces the friendly "Daily free limit reached — Upgrade" toast but is
  wired into only 6 call sites; every other capped feature surfaces the D1
  string at the exact moment the product should sell the upgrade.
- **D3. ~73 edge functions return raw `err.message` in their 500 path**, and
  `aiBrain.ts:503` embeds the upstream provider's response body in error
  messages — so a gateway hiccup surfaces provider/vendor internals in the
  UI. Several functions also pass raw upstream bodies through as
  `detail`/`details` on 502s (`azure-pronunciation/index.ts:390`,
  `realtime-session-token/index.ts:310,358`, `azure-tts/index.ts:166`, etc.).
- **D4. Dev-facing wording in learner UI:** "AI credits exhausted. Add funds
  in workspace settings." (`ConversationSimulator.tsx:168`, `ChatTab.tsx:144`,
  `MyPhrasesReview.tsx:154`, `LeechHelperPanel.tsx:113`) — Lovable workspace
  language, not product language. Lesson empty state says "Add vocabulary in
  the admin panel." to learners (`Learn.tsx:323`).
- **D5. Silent failures:** TTS play buttons fail silently everywhere
  (`useAzureTTS.ts:136-163`); word-tap enrichment permanently dead-ends per
  word after one failure (`TappableArabicText.tsx:132-159`); Souq-news "Quiz
  me" does nothing on failure (`ArticleQuiz.tsx:40-65`); lesson-quiz SRS
  writes (`Learn.tsx:247-249`) and alphabet progress
  (`AlphabetLetter.tsx:69-73`) drop silently after the XP celebration already
  fired.

---

## E. Pricing/billing truth gaps (investor-diligence risk)

- **E1. Tier benefits with no implementation.** Free "10 vocabulary words" /
  Standard "100 vocabulary words" / All-In "Unlimited vocabulary storage",
  "Basic/Full Discover content", "Priority AI processing"
  (`useSubscription.ts:25-54`, `Pricing.tsx:124-240`, FAQ `:280`): no vocab
  cap, no Discover tiering, and no priority queue exists anywhere in client
  or edge code. Tiers actually differ only via per-feature daily caps. The
  test fixture `seedAtFreeVocabCap` suggests a cap was once planned.
- **E2. Free card always says "Current Plan"** — even for paying subscribers
  and anonymous visitors (`Pricing.tsx:150-153`), so a Standard subscriber
  sees two cards claiming their plan.
- **E3. `check-subscription` failure silently downgrades a paying user** to
  locked/upsell UI (`useSubscription.ts:79-94`); conversely, an unrecognized
  Stripe product fails open to `allin` (`usageCap.ts:151`).
- **E4. Hardcoded fallback origin is a dead domain** —
  `create-checkout/index.ts:100` / `customer-portal/index.ts:50` fall back to
  `laha-arabic.lovable.app`, a typo of the two-rebrands-ago domain.

---

## F. Dead ends and empty-state problems (confirmed in screenshots)

- **F1. "Video not found" full-screen dead end** — bare text, no back/CTA
  (`DiscoverVideo.tsx:1742-1748`); also shown for fetch *errors*, and as the
  feed's inline overlay where the only escape is Esc/browser-back.
- **F2. Review empty state misleads new users** — "You've reviewed all your
  due Gulf curriculum words" + "0 Learning / 0 Mastered" for someone who has
  never reviewed; the "Back to Topics" button actually goes to `/`
  (`Review.tsx:318-321`). No CTA toward learning words. `/learn` with no data
  says "You've seen all available words" — wrong in both directions.
- **F3. MSA Bridge is permanently empty for Egyptian and Yemeni** — the only
  writer of `msa_transformation_rules` is a migration seeding 15 Gulf rows;
  the prominently linked /bridge page shows "coming soon" for the other two
  dialects (`MsaBridge.tsx:206-212`).
- **F4. Native Feedback can be a total dead end** — no starter credits, and
  if `STRIPE_FEEDBACK_PACK_PRICE` isn't set in prod, purchases are disabled
  too: a linked feature that's 100% unusable (`NativeFeedback.tsx:145-157`,
  `native-feedback/index.ts:82`). Check the prod secret.
- **F5. Session expiry is invisible** — refresh failure silently bounces to
  /auth, discarding in-progress state (`ProtectedRoute.tsx:25-28`).
- **F6. Assistant has no global entry on mobile** — the only global opener is
  Cmd/Ctrl+K (`AssistantMount.tsx:39-50`); pages without AskAI chips have no
  way in on a phone, despite `App.tsx:539-541` claiming every screen has it.
- **F7. Dark-mode bug in the first-run tour** — tooltip is hard-coded
  `bg-white` with theme-token text (`OnboardingTour.tsx:152`): unreadable in
  dark theme.
- **F8. Anonymous visitors can start flows that fail late** — Conversation
  Simulator lets you type and errors only after your first message
  (`ConversationSimulator.tsx:169`); anonymous placement results discarded
  (C4).

---

## G. Spend/abuse and correctness (not demo-visible, worth closing soon)

- **G1. Uncapped, effectively-anonymous paid endpoints:** `placement-quiz`
  (full model generation, no cap, callable with the public anon key),
  `score-set-phrase-voice` (Munsit ASR, same), `score-shadow-attempt`
  (`verify_jwt = false` **and** no cap — fully anonymous paid ASR).
  `bible-passage`, `generate-set-phrase-quiz`, `request-situation-phrases`
  also uncapped.
- **G2. CORS allows every `*.lovable.app`/`*.lovable.dev` origin**
  (`_shared/cors.ts:30`) — i.e. any other Lovable customer's app can make
  credentialed calls.
- **G3. Known 500s pinned as "warts":** `listening-quiz/index.ts:28` crashes
  with a raw TypeError when `words` is missing; `culture-guide` similar
  (pinned in `_test/robustness_test.ts:113-142`). One-line fixes.
- **G4. `create-checkout` 500s (with a raw null-property message) instead of
  401 on a missing auth header** (`create-checkout/index.ts:56`).
- **G5. Azure "no speech"/"no result" return HTTP 200 with an `error` key**
  (+ raw Azure payload) — clients checking `response.ok` treat them as scores
  (`azure-pronunciation/index.ts:397-413`).
- **G6. 30–90s spinners on council/critic endpoints** (`how-do-i-say`,
  `generate-story`, `reading-passage`) — within timeout, but pre-generate
  before a live demo.

---

## H. Housekeeping

- Console noise on learner pages: `MyTranscriptions.tsx:66` logs the user's
  UUID on every load; `Transcribe.tsx:929-1088` logs engine/budget/word dumps.
- Dead code: `RequireSubscription` paywall card unused;
  `src/lib/huggingface.ts` has zero real callers and its payload has drifted
  from `hf-chat`; deprecated `useBibleDisplayPrefs` still wired in.
- `useMsaRules.ts:25` casts `.from("msa_transformation_rules" as never)`,
  bypassing the schema contract the repo is otherwise rigorous about.
- Yemeni missing from the review flag map (`Review.tsx:38-41`).
- Landing/feed theme flash for anonymous visitors (`Feed.tsx:170-177`).
- CLAUDE.md still says lint baseline 537 (actual: 533).
- The tip commits "Work in progress"/"Lovable update" are harmless — a
  one-line generated-types version bump from Lovable auto-sync.

## Untested learner flows (no flow-level e2e spec)

`/tutor-upload`, `/clips`, `/native-feedback`, `/write`, learner
`/curriculum`, `/quiz/:lessonId`, learner `/reading-library`, and the
onboarding→placement handoff — the exact seam where C2/C3 live.

---

## Suggested priorities for the fix plan

- **P0 (before the demo):** B1 (comp the demo account + verify), B2, B3, B4
  (feed + review), C1, C2; decide the E1 story (either implement caps or fix
  the copy); F1; A1/A2 to get CI green so later fixes are gated.
- **P1 (before wider beta):** rest of C, D1/D2 (one shared invoke-error
  helper + wire `handleCapResponse` everywhere), B5, B6, F2–F5, G1, G3, G4.
- **P2:** D3–D5, E2–E4, F6–F8, G2, G5, G6, H.
