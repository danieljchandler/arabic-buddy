# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Hakiya — a web app for learning **spoken (dialectal) Arabic** (Gulf/Khaliji,
Egyptian, Yemeni), never Modern Standard Arabic (MSA / فصحى). Frontend: Vite +
React + TypeScript + shadcn-ui + Tailwind. Backend: Supabase (Postgres + RLS,
Auth, Deno Edge Functions). See `README.md` for the full feature/architecture
writeup — it is detailed and current; read it before large changes, especially
the sections on the Fusha row, learner mistakes, assistant context, grammar
mastery, and RBAC roles, which are not repeated here.

## Commands

```sh
npm run dev              # Vite dev server
npm run build             # production build
npm run lint               # eslint
npm run lint:ratchet    # fails only if lint error count increased — what CI runs
npm run typecheck        # tsc over src/ AND the e2e tree (two separate tsconfigs)
npm run check:edge       # deno check over supabase/functions/** (needs deno installed)

npm test                       # vitest run (unit + component)
npm run test:watch
npm run test:coverage
npx vitest run path/to/file.test.ts        # single unit/component test file
npx vitest run -t "test name"              # by test name

npm run test:e2e               # playwright, hermetic, no credentials needed
npm run test:e2e:ui            # playwright UI mode
npx playwright test e2e/foo.spec.ts        # single e2e spec

npm run test:edge              # deno test over supabase/functions/ (needs deno)
DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres \
  npx vitest run src/test/migrationReplay.test.ts   # schema-contract replay, needs a throwaway Postgres
```

CI (`.github/workflows/ci.yml`) runs three independent jobs on every push/PR:
typecheck+lint+unit+build, `deno check` on edge functions, and Playwright e2e.
`npm run lint:ratchet` is a ratchet (fails only on regressions — the repo has
pre-existing `no-explicit-any` debt); `deno check` on edge functions is a clean
gate with no tolerated debt. Full details, including *why* each check exists
and what it has caught, are in `README.md` and `docs/testing.md` — read those
before touching CI config, the env-guard tests, or the edge-function test
harness.

## Non-obvious things that will bite you

- **Env vars for tests are not `.env`.** `vite.config.ts` uses `envDir:
  ".vite-env"` (empty), so root `.env` is ignored for the app build, and the
  Supabase client vars fall back to the **real production project** when
  unset. Vitest and Playwright configs point at a fake host
  (`https://e2e.supabase.co`) instead — never make them mirror
  `vite.config.ts`'s fallback. `src/test/envGuard.test.ts` guards this; read it
  before changing how config is loaded.
- **Edge functions have no exported handler.** All 84 functions in
  `supabase/functions/` call `serve()`/`Deno.serve()` at module scope.
  `supabase/functions/_test/harness.ts` intercepts both forms via an
  import-map shim and a `Deno.serve` monkey-patch; `loadFunction(name)` is how
  tests get a callable handler with faked secrets and routed `fetch`.
- **Model IDs are centralized.** Never hardcode a model ID in feature code —
  everything goes through `supabase/functions/_shared/modelRegistry.ts`
  (named lineups: `TRANSLATION`, `CONTENT`, `UTILITY`, `REASONING`). Claude
  routes via OpenRouter, Gemini via the Lovable AI Gateway.
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
identity, an MSA-leak detector, a repair pass, and an optional native-speaker
validator over whichever model lineup is requested from `modelRegistry.ts`.
Every edge function that generates or judges Arabic content calls through
this, not the gateway directly.

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

**Reads vs. writes are deliberately asymmetric** in several tables
(`learner_errors`, `user_concept_mastery`, `learner_ai_memory`) — clients read
their own rows under RLS but writes go through edge functions under the
service role, so nobody can post themselves a score or plant a fake memory.
When adding a table a client should only partially control, follow this
pattern rather than a blanket RLS policy.

**RBAC**: roles live in `public.user_roles`, admin-writable only. Roles:
`admin`, `content_reviewer`, `beta_tester`, `bible_reader` — see README for
exact scoping (e.g. `bible_reader` is overridden when the user is also
`content_reviewer`).

## Project layout

- `src/` — React app; domain/pure logic lives in `src/lib` (unit-tested,
  co-located `*.test.ts`), not in components.
- `supabase/functions/` — Deno edge functions, one directory per function,
  `_shared/` for cross-function modules, `_test/` for the harness and edge
  function tests.
- `supabase/migrations/` — schema + RLS, applied in filename order.
- `contract/` — rebuilds the schema from migrations against stock Postgres.
- `curriculum/`, `docs/` — source lesson spreadsheets/docs and planning notes
  (`docs/` includes dialect-specific corpus work under `docs/yemeni/`).
- `e2e/` — Playwright specs, one file per functional area; `e2e/support/`
  seeds a fake auth session and answers requests from fixtures (no network).
