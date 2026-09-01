# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Hakiya — a web app for learning **spoken (dialectal) Arabic** (Gulf/Khaliji,
Egyptian, Yemeni), never Modern Standard Arabic (MSA / فصحى). Frontend: Vite +
React + TypeScript + shadcn-ui + Tailwind. Backend: Supabase (Postgres + RLS,
Auth, Deno Edge Functions). See `README.md` for the full feature/architecture
writeup — it is detailed and current; read it before large changes, especially
the sections on the Fusha row, learner mistakes, assistant context, grammar
mastery, and RBAC roles, which are not repeated here. `docs/testing.md` is the
companion for anything test- or CI-shaped.

## Commands

```sh
npm run dev              # Vite dev server
npm run build            # production build
npm run lint             # eslint
npm run lint:ratchet     # fails only if lint error count increased — what CI runs
npm run typecheck        # tsc over src/ AND the e2e tree (two separate tsconfigs)
npm run check:edge       # deno check over supabase/functions/** (needs deno installed)

npm test                 # vitest run (unit + component)
npm run test:watch
npm run test:coverage    # what CI runs — enforces per-directory thresholds
npx vitest run path/to/file.test.ts        # single unit/component test file
npx vitest run -t "test name"              # by test name

npm run test:e2e         # playwright, hermetic, no credentials needed
npm run test:e2e:ui      # playwright UI mode
npx playwright test e2e/foo.spec.ts        # single e2e spec

npm run test:edge        # deno test over supabase/functions/ (needs deno)
DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres \
  npx vitest run src/test/migrationReplay.test.ts   # schema replay, needs a throwaway Postgres
```

CI (`.github/workflows/ci.yml`) runs **four** independent jobs on every push/PR:

1. **Typecheck, lint & unit tests** — `typecheck`, `lint:ratchet`,
   `test:coverage` (with thresholds), then a production `build`.
2. **Typecheck edge functions (Deno)** — `deno check` *and* `npm run test:edge`,
   so the edge job is a runtime gate, not just a compile one.
3. **Migration replay** — replays every migration against a stock `postgres:16`
   service container (`contract/prelude.sql` supplies the `auth`/`storage`
   objects the migrations expect, instead of standing up the whole Supabase
   stack).
4. **End-to-end** — Playwright, sharded 4 ways, Chromium only, no secrets.

`npm run lint:ratchet` is a ratchet (fails only on regressions — the repo has
pre-existing `no-explicit-any` debt); `deno check` on edge functions is a clean
gate with no tolerated debt. Full details, including *why* each check exists
and what it has caught, are in `README.md` and `docs/testing.md` — read those
before touching CI config, the env-guard tests, or the edge-function test
harness.

## Non-obvious things that will bite you

- **A misconfigured test run talks to production and still goes green.**
  `vite.config.ts` uses `envDir: ".vite-env"` (empty), so root `.env` is ignored
  for the app build, and the Supabase client vars **fall back to the real
  production project** when unset. Four layers guard this and none of them may
  be removed casually: `vitest.config.ts` `test.env` and
  `playwright.config.ts` `webServer.env` both point at the fake host
  `https://e2e.supabase.co` (never make them mirror `vite.config.ts`'s
  fallback), `e2e/support/globalSetup.ts` refuses to start if that didn't take
  effect, and `src/test/setup.ts` replaces `fetch` with one that throws.
  `src/test/envGuard.test.ts` asserts all four are still in place.
- **Drift-guard tests fail when you *add* code, not when you break it.** A
  cluster of meta-tests in `src/test/` reads a source of truth off disk and
  fails on drift, so landing new code without its counterpart turns the fast
  unit job red:
  - `edgeFunctionCoverage` — every dir in `supabase/functions/` must be named
    by a file in `supabase/functions/_test/`.
  - `libCoverage` / `hookCoverage` / `sharedModuleCoverage` — every module in
    `src/lib`, `src/hooks`, `supabase/functions/_shared` must be named by some
    test (each has a short, reasoned exemption list).
  - `routeManifest` — every `<Route>` in `src/App.tsx` needs an entry in
    `src/test/support/routes/manifest.ts`.
  - `routeReachability` — every learner route needs an in-app link, or an
    entry in the `NO_LINK_NEEDED` allow-list with a written reason.
  - `grammarTaxonomy` parses a migration; `typesDrift` checks the
    generated-types drift allow-list against the migrations that caused it.
  These checks are deliberately *shallow* — a name in a test file is a claim
  someone looked at it. Don't satisfy them with an empty test; depth is what
  review is for.
- **Unit coverage is gated per-directory, not globally.** `vitest.config.ts`
  sets thresholds for `src/components/**`, `src/hooks/**`, `src/lib/**` and
  `src/contexts/**` only (`src/pages/**` is covered by Playwright and would
  drag any global number to a meaningless floor). They're set a couple of
  points under the measured figures and are a ratchet — raise them when the
  real numbers move up.
- **The lint ratchet has a hard-coded baseline.** `scripts/lint-ratchet.mjs`
  pins `BASELINE` (currently 537 errors). If you legitimately reduce the count,
  lower `BASELINE` in the same commit — the script prints the new number.
- **Flashcard scheduling is FSRS-5, not FSRS-4.5 or SM-2.** `src/lib/spacedRepetition.ts`
  implements the stock FSRS-5 parameters and formulas (Anki ships this since
  24.11). The reason it has to be v5: FSRS-4.5 has no model for a review on
  the *same day* as the card's last one (relearn queue, a lesson quiz, a
  same-day re-review) — retrievability is ~1, the stability growth term
  collapses to zero, and Hard/Good/Easy all produce the identical interval.
  FSRS-5's short-term formula `S' = S · e^(w17·(G−3+w18))` is what makes those
  ratings actually differentiate. Post-lapse stability is capped at the
  pre-lapse value (forgetting only ever lowers the estimate, never raises it),
  and a card still in learning keeps its memory state instead of
  re-initialising as brand-new. Don't "simplify" this back toward 4.5 or SM-2 —
  that's exactly the bug it fixes.
- **Vitest and Playwright share one in-memory Supabase backend.**
  `src/test/support/` is a real PostgREST emulator — it parses the query,
  applies filters/ordering/limits/counts, persists writes, and implements RPCs
  and edge functions (`server/`, `postgrest/`, `factories/`, `personas.ts`),
  reached through `transports/vitest.ts` and `transports/playwright.ts`. It
  derives its schema from `src/integrations/supabase/types.ts` and **rejects
  unknown columns exactly as PostgREST does**, so a fixture inventing a field
  fails instead of silently matching nothing. Every Playwright worker gets its
  own database, so there's no shared state.
- **Edge functions have no exported handler.** Every function in
  `supabase/functions/` calls `serve()`/`Deno.serve()` at module scope.
  `supabase/functions/_test/harness.ts` intercepts both forms via an
  import-map shim and a `Deno.serve` monkey-patch; `loadFunction(name)` is how
  tests get a callable handler with faked secrets and routed `fetch`.
- **Model IDs are centralized; providers are chosen, not hardcoded.** Never
  hardcode a model ID in feature code — everything goes through
  `supabase/functions/_shared/modelRegistry.ts` (named lineups: `TRANSLATION`,
  `CONTENT`, `UTILITY`, `REASONING`, plus `IMAGE_MODEL_IDS`). `src/test/modelRegistry.test.ts`
  enforces this in both directions: a new hardcoded id fails, and so does an
  entry left on the allow-list after it was fixed. Which *provider*
  serves a model is `_shared/aiGateway.ts`'s decision, off the vendor prefix:
  `google/*` → Google (`GEMINI_API_KEY`), `openai/*` → OpenAI
  (`OPENAI_API_KEY`), `Fanar-*` → QCRI (`FANAR_API_KEY`), everything else →
  OpenRouter (`OPENROUTER_API_KEY`). Fanar is the one vendor with no OpenRouter
  twin, so it never falls back there — `canFallBack` is what encodes that.
  Registry ids stay in OpenRouter's `vendor/model` form because that is the one
  namespace all three can be addressed from; aiGateway strips the prefix for the
  vendors whose own APIs don't use it. Call models with `chatFetch` /
  `chatFetchDetailed` / `generateImage` rather than a bare `fetch` to a
  provider URL, and never reintroduce a hosting provider's AI gateway.
  **OpenRouter is also the safety net:** when a vendor's key is missing, or its
  API answers with a status in aiGateway's fallback set (400/401/403/404/408 and
  5xx — deliberately *not* 429), the same model is retried once through
  OpenRouter. That is a provider swap, never a model swap. Two consequences for
  tests: "the upstream is down" means stubbing both routes, and "the AI is not
  configured" means unsetting every provider key (`NO_AI_PROVIDER` in the edge
  harness), not one.
- **`contract/` and `_test/schemaContract.test.ts` check different things.**
  The former replays all migrations against stock Postgres (can the schema be
  rebuilt from scratch); the latter statically checks every `.from()`/`.rpc()`/
  `functions.invoke()` call against generated types (would a renamed column
  fail silently at runtime). Both currently pin known gaps as baselines rather
  than fixing them — see `docs/testing.md` for what and why.
- **Pronunciation scores are calibrated, not raw.** `azure-pronunciation` does
  not return Azure's PronScore — `_shared/pronunciationScoringCore.ts` rescores
  a word on its worst phoneme as well as its average, lets fluency/completeness
  only ever subtract, and stretches the top of the scale. Azure's originals come
  back under `raw`. Don't compare a score in the app against Azure's docs or
  portal, and don't "fix" a number that looks low by reverting to `raw`. The
  shadowing path has its own calibration in `src/lib/shadowScoring.ts`, for a
  different reason: ASR snaps to real words, so a clean transcript is evidence
  about word choice and not about pronunciation.
- Test code is held to a *stricter* lint standard than the app (no `any`, no
  `.only`) — see the override in `eslint.config.js`.

## Architecture

**AI generation** goes through a shared orchestrator, not direct gateway
calls: `supabase/functions/_shared/aiBrain.ts` (`askBrain()`) layers dialect
identity, worked dialect examples, an MSA-leak detector, a repair pass, and an
optional native-speaker validator over whichever model lineup is requested from
`modelRegistry.ts`. The worked examples (`getDialectDemonstrations`) are the
*front* half of the MSA fight and the cheap one — models under-produce dialect
out of reluctance rather than inability, and demonstration moves them where
instruction does not (AL-QASIDA, arXiv:2412.04193). They ride in the prompt's
stable cached prefix, so they cost tokens once per dialect rather than per call,
and `dialect_demonstrations_test.ts` asserts they are leak-free under the
detector's own lists — a leak inside a demonstration is taught, not caught.
Set `skipDemonstrations` only for tasks that emit no Arabic prose (routing,
triage); that is a narrower question than `skipRepair`. A
task picks a `Strategy` — `solo`, `ensemble`, `draft_critic` or `council` — and
`streamBrain()` is the streaming counterpart for chat-shaped responses. Every
edge function that generates or judges Arabic content calls through this, not
the gateway directly.

**The learner model** conditions generation on what a learner actually knows.
`_shared/learnerProfile.ts` assembles known/in-progress/weak vocabulary from
real SRS state, CEFR placement, and stated interests; its pure half
(`learnerProfileCore.ts`) is unit-tested. Generators pass this to `askBrain`
as `systemPromptExtra`. Never build this list client-side or accept one from
the client — it must be assembled server-side from the DB.

**Assistant (Ask AI) context** is layered rather than a single blob:
`usePageAiContext` publishes structured `content`/`document`/`meta`/`position`,
budgeted and windowed (not truncated) by `_shared/pageContextCore.ts` and
shared verbatim between the client and edge functions; semantic retrieval over
`content_embeddings` via `_shared/contentRetrieval.ts`; callable tools in
`_shared/assistantTools.ts` (routed through `assistantToolRouter.ts` for chat,
declared directly on the Realtime session for voice); on-screen OCR timing via
`_shared/visualTimelineCore.ts`; and cross-session notes via
`_shared/learnerMemory.ts`. Each layer degrades independently rather than
erroring.

**Grammar mastery** parallels the vocabulary SRS but for structures:
`user_concept_mastery`, updated by `record-grammar-outcome`, keyed on a fixed
set of category ids shared with `curriculum_concepts.key`. Both writers that
tag content with grammar concepts go through `_shared/grammarTaxonomy.ts` so
free-text model output and the mastery ladder agree on one key space. Core
logic (pure, tested) is in `_shared/conceptMasteryCore.ts`; a wrong answer
never promotes, only demotes.

**Curriculum**: stages/lessons in `curriculum_stages`/`lessons`, progress in
`lesson_progress`, path/gating logic pure and tested in `src/lib/lessonPath.ts`.
Gating is soft — `unlock_condition` is free-text guidance, not an enforced
rule. Lesson content is imported from `.xlsx` (`src/lib/parseLessonXlsx.ts`).

**Access, spend and abuse controls** are cross-cutting concerns every
model-calling function must respect, not per-function decisions:
`_shared/usageCap.ts` resolves the caller (`resolveUserId`), their tier
(`getSubscriptionTier`), and enforces `requireActiveSubscription` /
`enforceDailyCap`; `_shared/voiceBudget.ts` does the equivalent for realtime
voice minutes; `_shared/cors.ts` serves an `ALLOWED_ORIGINS` allow-list rather
than `*`. Billing itself is `create-checkout`, `check-subscription`,
`customer-portal` and `referral` (Stripe ids are guarded by
`src/test/stripeIds.test.ts`). Four fire-and-forget sinks record what happened
— `llmUsageLogger`, `msaViolationLogger`, `trainingExampleLogger`,
`featureMetrics` — and they swallow their own errors so they can never fail
the request they're attached to, which also means they can stop working
silently.

**Reads vs. writes are deliberately asymmetric** in several tables
(`learner_errors`, `user_concept_mastery`, `learner_ai_memory`) — clients read
their own rows under RLS but writes go through edge functions under the
service role, so nobody can post themselves a score or plant a fake memory.
When adding a table a client should only partially control, follow this
pattern rather than a blanket RLS policy.

**RBAC**: roles live in `public.user_roles`, admin-writable only, and are
checked through the `has_role` RPC (never by reading the table client-side).
The `app_role` enum carries `admin`, `user`, `content_reviewer`, `recorder`,
`beta_tester`, `bible_reader`, `complimentary` and `transcriber`. `useAdminAuth`
collapses the staff-facing ones into a single
`admin | content_reviewer | recorder | transcriber | null` role; see README for
exact scoping (e.g. `bible_reader` is overridden when the user is also
`content_reviewer`). Adding an enum value takes **two migration files** —
Postgres will not use a value in the transaction that added it — and touches
more than the SQL: `src/lib/rbac.ts` (`MANAGED_ROLES` drives the grant UI),
`useAdminAuth`, the generated types, `src/test/support/personas.ts`,
`src/test/support/server/rpc.ts`, and the route manifest.

**Transcript review** is where native speakers correct the pipeline's output.
It lives on the Manage Videos pages: `/admin/videos` doubles as the review
queue and each video's `/admin/videos/:id/edit` page carries the workspace
(the old `/admin/transcribe*` addresses just redirect there). A `transcriber`
reaches only those two pages, and the pages hide the management surface from
them — RLS and the edge function are what actually refuse the writes. Three
tables (`transcript_line_reviews`,
`transcript_line_revisions`, `transcript_line_comments`) key off a line id
*inside* the `discover_videos.transcript_lines` jsonb array, since the transcript
is a blob rather than rows. Reads are RLS'd to reviewers; **all writes go
through the `transcript-review` edge function**, which computes the diff against
what is actually stored — an audit trail its own subject can author is worth
nothing. That includes the transcript itself: the edit page persists lines via
`save_lines` for every role (that is what writes the revision log), keeping
local edits as an on-device draft with a visible "not saved yet" state until
saved. A checkmark stores the text it approved so it can be shown as stale
when the line moves on; note that merging keeps the *left* line's id, so without
that snapshot a tick would silently carry onto unread words. Reviewer chrome in
`TranscriptEditor` hangs off one optional `lineReview` prop — the video edit
page supplies it, the create form does not. The reviewer also sets the **sub-dialect** — a second
dropdown that depends on the dialect, off the taxonomy in
`_shared/dialectSubvarieties.ts` (`dialect_subvariety`) — and lists what marks
the clip as that variety (`dialect_features`), which is a separate key space
from `grammarTaxonomy.ts` on purpose: most of what places a speaker is a sound,
a borrowing or an intonation, not a grammar category. Full writeup in README.

## Project layout

- `src/` — React app; domain/pure logic lives in `src/lib` (unit-tested,
  co-located `*.test.ts`), not in components. `src/pages` holds route
  components — exercised by Playwright rather than Vitest, and excluded from
  the coverage thresholds; `src/hooks` holds most of the app's decisions and
  is covered by Vitest under a threshold.
- `src/test/` — shared harness plus cross-cutting suites with no single home:
  the drift guards above, the tests for `supabase/functions/_shared/*` (Deno
  modules that can't sit in the Vitest include glob), and `support/`, the
  in-memory Supabase backend.
- `supabase/functions/` — Deno edge functions, one directory per function,
  `_shared/` for cross-function modules, `_test/` for the harness and edge
  function tests (`_test/eval/golden` holds the golden-set eval fixtures).
- `supabase/migrations/` — schema + RLS, applied in filename order.
- `contract/` — rebuilds the schema from migrations against stock Postgres.
- `curriculum/`, `docs/` — source lesson spreadsheets/docs and planning notes
  (`docs/` includes dialect-specific corpus work under `docs/yemeni/`, plus
  `testing.md`, `sharing.md` and `tts-voice-routing.md`).
- `e2e/` — Playwright specs, one file per functional area; `e2e/support/`
  seeds a fake auth session and answers requests from the same in-memory
  backend as the unit suite (no network).
- `scripts/` — repo tooling that isn't part of the app build: the lint
  ratchet, corpus/artifact derivation, illustration generation, training-data
  export.
