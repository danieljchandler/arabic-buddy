# Site functionality audit — 2026-09-03

Full pass over every route in `src/App.tsx` (learner, AI, content, social,
account and admin), every edge function they invoke, and the schema they
read and write, taken on branch `claude/site-functionality-audit-jqywx4`
at commit `94395d1`. Each item below was traced in code and, where a
runtime check was possible, reproduced locally.

## Automated checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint:ratchet` | pass (530 errors, at baseline) |
| `npm test` (vitest) | pass — 359 files, 6085 tests |
| `npm run build` | pass |
| `npm run check:edge` (deno check) | pass |
| `npm run test:edge` | pass — 1844 tests |
| Migration replay (stock Postgres 16) | **FAIL** — see B1 |
| `npm run test:e2e` (Playwright) | in progress at time of writing; result appended below when it finishes |

## A. Confirmed broken — learner-facing

### A1. Paying subscribers are reported as "Free plan"
`supabase/functions/check-subscription/index.ts:125` reads
`subscription.current_period_end`. The Stripe client is pinned to
`apiVersion: "2025-08-27.basil"` (line 97, `stripe@18.5.0`), and the
Basil API versions removed `current_period_start/end` from the
Subscription object (they now live on each `items.data[i]`). For any
learner with an active subscription the value is `undefined`, so
`new Date(NaN).toISOString()` throws a `RangeError`, the handler returns
500, and the `subscribers` row is never written. Effect: `/pricing` and
`/settings` show the free plan, `useSubscription` stays unsubscribed, and
`usageCap` applies free-tier daily caps to paying users. Admin and
`complimentary` users are unaffected (early return). The edge test at
`_test/payments_test.ts:408` mocks the pre-Basil shape, which is why it
passes. Fix: read `subscription.items.data[0].current_period_end` (and
update the test fixture).

### A2. C-test never builds a test (`/placement/c-test`)
`src/pages/CTest.tsx:59-63` calls `reading-passage` and passes the whole
response to `linesFrom(data)`, which expects `data.lines` or a string
`data.passage`. The function actually returns
`{ passage: { title, lines: [...] }, _timing }`
(`supabase/functions/reading-passage/index.ts:309`; `ReadingPractice.tsx`
handles it correctly via `normalizePassage(data.passage)`). So `linesFrom`
returns `[]` and the page always shows "The passage was too short to make
a test from." The e2e spec and the emulator stub both return
`{ passage: "<string>" }`, which is why they pass. Regression from
`5b2a003`. Fix: `linesFrom(data?.passage)` and correct the stub/spec.

### A3. Culture Guide chat always answers "Please sign in"
`src/pages/CultureGuide.tsx:118` sends
`Authorization: Bearer <VITE_SUPABASE_PUBLISHABLE_KEY>` (the anon key)
rather than the session token. `culture-guide/index.ts:103` calls
`enforceDailyCap`, which resolves the user with `auth.getUser(token)`
(`_shared/usageCap.ts:45-56`); the anon key yields no user, so it returns
401 `auth_required`. Every other page does this correctly with
`session.access_token` (e.g. `ListeningPractice.tsx:205`). Pre-existing
since PR #308. Fix: use the session token and add the `apikey` header.

### A4. Friends page shows streak 0 for everyone
`src/hooks/useSocial.ts:111-115` selects `review_streaks` for followed
users, but the only SELECT policy is "Users can view their own streaks"
(`20260529155315…sql`). PostgREST returns `[]` silently. XP and profiles
have public-when-`show_on_leaderboard` policies; streaks need the same.

### A5. Referral link parameter is dead
`src/components/social/ReferralCard.tsx` shares
`https://hakiya.app/?ref=CODE`, but nothing in `src/` reads a `ref`
query parameter. The referred friend must type the code by hand.

## B. Confirmed broken — build, schema, CI

### B1. Duplicate migration breaks replay (CI job 3 is red on HEAD)
`supabase/migrations/20260903042227_22c0e029-….sql` (commits `9f61a27`,
`94395d1`) is the seven `20260902000000`–`20260902060000` files
concatenated (comments stripped) plus exactly four new statements:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_perception_progress TO authenticated;
GRANT ALL ON public.user_perception_progress TO service_role;
GRANT SELECT, INSERT ON public.placement_results TO authenticated;
GRANT ALL ON public.placement_results TO service_role;
```

Its `CREATE TABLE public.review_log` (and `user_perception_progress`,
`dialect_word_frequency`, `placement_results`, their indexes, policies and
triggers) has no `IF NOT EXISTS`, so replay fails at line 4 with
`relation "review_log" already exists`. Reproduced with
`DATABASE_URL=… npx vitest run src/test/migrationReplay.test.ts`; the
GitHub Actions run for `94395d1` shows only the Migration replay job red.
Because `8b2f499` first removed these tables from `types.ts` and
`9f61a27` re-added them alongside the dashboard file, production most
likely has the new file recorded and not the seven, so whichever set the
ledger lacks will fail on the next `supabase db push`. Fix: reduce the
new file to the four GRANT statements (idempotent), and reconcile
`supabase_migrations.schema_migrations` on production so the seven are
marked applied.

### B2. Admin Set Phrases back button lands on 404
`src/pages/admin/AdminSetPhrases.tsx:125` does
`navigate("/admin/dashboard")`; the admin router has only an `index`
child, so this falls to the top-level NotFound. Should be `/admin`.

### B3. Curriculum Builder fails on the first message of every new session
`src/pages/admin/CurriculumBuilder.tsx:60` defaults a new session to
`google/gemini-3.5-flash-lite`, which is not a key in
`curriculum-chat/index.ts` `MODEL_REGISTRY`, so the function returns 400
"Unknown model". The picker (`ModelSelector.tsx:55,62,68`) also offers
`qwen/qwen3-max` and `google/gemini-2.5-pro`, neither of which is
registered. Three of eight options are dead, including the default.

### B4. Content reviewers get success toasts for writes RLS refuses
`src/lib/rbac.ts:62-68` opens `/admin/set-phrases`, `/admin/chunks` and
`/admin/dialect-rules` to `content_reviewer`, but:
- `set_phrases` / `set_phrase_occasions` writes are `is_admin()` only
  and drafts are hidden from non-admins (`20260509193637…sql`). Publish,
  edit and add-occasion do not check the row count and toast "Saved".
  `AdminChunkCandidates.tsx:94` promote is refused the same way.
- `dialect_rules` DELETE was never widened to `can_manage_content()`
  (`20260706075500` only redefines SELECT/INSERT/UPDATE), and
  `dialect_rule_violations` is admin `FOR ALL`, so "Delete rule" and
  "Resolve" silently no-op for reviewers.
Either widen the policies or hide those actions from the role.

## C. Suspicious, dormant, or needs a production check

- **`/set-phrases/review` is the same session as "Mixed practice".**
  `SetPhrasesReview.tsx` renders `<SetPhrasesPractice reviewMode />`, but
  `reviewMode` only changes the Ask-AI title; no review flag reaches
  `generate-set-phrase-quiz`.
- **Frequency-first new-card admission is dormant.** Nothing calls
  `derive-word-frequency` (no cron, no client), so every
  `frequency_rank` is NULL and ordering degrades to due-date. Needs the
  external scheduler and `FREQUENCY_DERIVE_SECRET` documented in
  `docs/follow-ups-2026-09.md`.
- **`review_log` is trigger-populated; the emulator has no triggers**, so
  `useFsrsFit` and `usePlacementHistory` are untested against a real
  trigger. Worth one rating in production and
  `select count(*) from review_log`, especially given B1 leaves it
  unclear which copy of the trigger production has.
- **37 edge function directories are absent from `supabase/config.toml`**
  (`translate-text`, `realtime-session-token`, `assistant-tools`,
  `discover-feed`, `phrase-of-the-day`, `notify-due-reviews`, …). They
  inherit `verify_jwt = true`. Fine while the publishable key is a legacy
  JWT; every anonymous call to them breaks if it is ever switched to an
  `sb_publishable_…` key.
- **`ConversationSimulator.tsx:87`**: `liveTopic` is passed to the live
  voice panel but `setLiveTopic` is never called, so topic chips never
  reach a voice session.
- **`ReadingPractice.tsx:494`** reads `picked.lines` off
  `reading_passages`, a column that does not exist, so curated passages
  always fall through to punctuation splitting.
- **`Profile.tsx:1402`** "view all" under Recent badges goes to
  `/leaderboard`, which has no badges list.
- **`CoverageHeatmap.tsx:101-105`** "Draft" passes `state.seedPrompt` to
  `/admin/curriculum-builder`, which never reads `location.state`.
- **Reviewer storage writes**: `video-audio` and `flashcard-images`
  INSERT are `is_admin()` only, so a reviewer's audio staging and
  thumbnail capture on `/admin/videos/:id/edit` fail "non-fatally";
  `discover_videos` DELETE is admin-only while the button is shown.
- **`AdminLayout.tsx:24`** admits `recorder` to every `/admin/*` page;
  most load with error toasts. Matches the route manifest, but noisy.
- **`useTodayQueue.ts:220`** renders "Last placed {cefr_level}" and
  `cefr_level` is now nullable after the C-test change.
- **`MyWords.tsx:181`** "Find roots" → `enrich-word-roots` has no
  emulator handler, so it is untested end to end.
- **`contract/build.mjs`** header says each migration runs in its own
  transaction, but `apply()` does not pass `-1`, so a failing file leaves
  its earlier statements applied.
- **Undocumented env vars** with silent fallbacks:
  `STRIPE_ANNUAL_PRICE_STANDARD`, `STRIPE_ANNUAL_PRICE_ALLIN` (annual
  plans vanish if unset), `STRIPE_REFERRAL_COUPON` (rewards off),
  `SHAHEEN_MT_DAILY_LIMIT`.
- **Dialect pickers** on `AdminStoryForm` and `AdminReadingLibrary` offer
  Levantine and MSA, which nothing downstream teaches.

## Verified working

Every other route was traced and found consistent: all `functions.invoke`
names have a directory, every `.from()`/`.rpc()` target exists in
`types.ts` and a migration, every `navigate`/`Link` target exists in
`App.tsx` (except B2), request and response shapes match on every
client–function pair checked, and `conversation-practice` is fully gone.
The `types.ts` regeneration in the last three commits only added
`phrase_quality_to_rating` and parenthesised the helper generics; nothing
the client uses was dropped and the emulator's schema parser is
unaffected.
