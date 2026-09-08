# HUMAIN M3 — integration plan

Status: **proposal**, written 2026-09-08 against the pipeline as it stands.
Nothing here is implemented yet.

M3 is HUMAIN's frontier Arabic model (428B MoE, ~23B active, announced at LEAP
Riyadh on 2026-09-03, weights built with MiniMax), served from HUMAIN Node
behind an **OpenAI-compatible** `/chat/completions` endpoint. Two preview
tiers are documented publicly: a limited preview with a Saudi alignment
guardrail, thinking and streaming off, and added latency; and a research
preview with the full checkpoint, thinking, streaming and lower latency.

Three properties decide everything below:

1. **It is OpenAI-shaped.** That is the shape this whole codebase already
   speaks, so it costs a route, not an adapter.
2. **It is on nobody else's catalogue.** Like Fanar and Jais 2, it has no
   OpenRouter twin, so `canFallBack` must stay false for it and it can never be
   the sole path for anything a learner waits on.
3. **The preview tier explicitly adds latency.** That rules it out of the
   latency-critical paths (the transcript merge, live chat) until measured.

Before writing any of this, confirm three facts against the key with one call —
the plan assumes them and they are the only things not verifiable from here
(`node.humain.com` refuses unauthenticated fetches):

```sh
curl https://<node-base>/v1/chat/completions \
  -H "Authorization: Bearer $HUMAIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"humain-m3","messages":[{"role":"user","content":"مرحبا"}],"max_tokens":32}'
```

- the base URL,
- the exact served model id (`humain-m3`, or a versioned variant),
- whether it accepts `reasoning_effort` / `reasoning` or 400s on it,
- whether the response carries a `usage` block with cost (it decides whether
  spend telemetry is real or has to be priced from a table).

---

## 1. Integration points

### 1a. The gateway seam (required, ~40 lines, no behaviour change on its own)

`modelRegistry.ts` answers *which model*, `aiGateway.ts` answers *whose API*.
M3 needs one entry in each, and nothing else in the codebase should learn its
name.

**`_shared/modelRegistry.ts`**

```ts
// HUMAIN M3 — 428B MoE Arabic frontier model on HUMAIN Node. Like Fanar and
// Jais 2 it exists on exactly one endpoint, so it has no OpenRouter twin and
// aiGateway.canFallBack deliberately leaves it alone. Registry ids stay in
// vendor/model form; the prefix is stripped on the wire.
HUMAIN_M3: 'humain/humain-m3',
```

plus a `REASONING_FLOOR` entry. Start at `'none'` and let `reasoningFieldFor`
return `null` for the provider entirely (as it already does for Fanar and
RunPod) until the curl above proves the field is accepted — a 400 on every call
costs a round trip on every call.

**`_shared/aiGateway.ts`** — five small edits, each mirroring the Fanar case
that is already there:

| Site | Change |
| --- | --- |
| `Provider` union | add `'humain'` |
| `HUMAIN_CHAT_URL` | the Node base + `/v1/chat/completions` |
| `HUMAIN_MODEL` regex | `/^humain\//` → `vendorForModel` returns `'humain'` |
| `keyFor` / `KEY_ENV` / `CHAT_URLS` | `HUMAIN_API_KEY` |
| `upstreamModelId` | strip the `humain/` prefix |
| `canFallBack` | unchanged — stays false, which is the point |

A missing `HUMAIN_API_KEY` then makes `tryChatRoute` return `null`, which is
already the codebase's word for "unconfigured provider, skip silently". That
is what lets every consumer below ship dark and light up when the secret lands.

### 1b. Where to actually use it, in the order worth doing

**First: a leg of the dialect validator.** `_shared/dialectValidator.ts` already
runs a Gemini Pro judge, a Mistral Saba Arabic leg, and a tie-break ladder
(Jais 2 8B → Fanar) consulted only when the two standing legs split. Judging
whether a line reads as native dialect is precisely what an Arabic-native
frontier model is for, and this slot is the safest place in the app to test a
new key: the validator is optional by design — it returns `unknown`/`ok:false`
when its provider is unavailable, so a bad key, a rate limit or a slow preview
tier degrades the gate instead of failing the request behind it.

Concretely: put M3 at the head of the tie-break ladder, ahead of Jais 2, under
the same `tryChatRoute` guard and the same `TIEBREAK_COLD_BAIL_MS` /
`TIEBREAK_BUDGET_MS` ceilings. Ladder position costs nothing when the key is
absent and bounds the latency risk when it is present. If it proves fast and
good there, promote it to the standing Arabic leg in place of Saba — that is a
one-constant change and Saba's own comment says it holds the slot on price, not
quality.

**Second: a TRANSLATION drafter — but only behind an eval.** The `TRANSLATION`
lineup is `[CLAUDE, GEMINI_FLASH]` under `strategy: 'ensemble'`, and
`runEnsemble` already ranks candidates by weighted Jaccard agreement and MSA
leak count, so a third drafter needs no new machinery: it is one array entry
plus a `MODEL_WEIGHTS` entry. What it does need is evidence, and the repo
already has the instrument:

```sh
HUMAIN_API_KEY=... OPENROUTER_API_KEY=... deno run --allow-env --allow-read --allow-net \
  scripts/eval-dialect-live.ts --model humain/humain-m3 --compare anthropic/claude-sonnet-5
```

That runs the frozen golden set through the same dialect prompt the Brain
builds and prints the per-dialect leak-rate delta. Run it per dialect — the
interesting question is not "is M3 better at Arabic" (it will be) but "is it
better at *Gulf, Egyptian and Yemeni* than a model that is already paid for",
and a Saudi-commissioned model has an obvious prior toward Gulf and an
unexamined one on Yemeni. Ship the lineup change only if the delta is real.
Note the ensemble runs every drafter on every call: a third leg is a permanent
+50% on translation cost and moves latency to the slowest drafter, which the
preview tier warns is M3.

**Third, and not yet: the analyser's workhorse.** The transcript merge runs on
`QWEN_FAST` for a documented reason — the Max tier's mandatory reasoning turned
a forty-second merge into a multi-minute one and starved the translation
ensemble sharing its 300-second budget. Whatever M3's quality, "added latency"
is disqualifying there until measured. Same for `DEFAULT_CHAT` and anything on
the realtime path.

**Explicitly not:** `UTILITY`. That lineup is the app's highest-volume Arabic
path; changing it is a cost and latency decision, not a quality one.

---

## 2. Exposing it as a translator/contributor feature

The instinct is to build a contributor tool. Don't — the app already has one,
in three parts, and M3 slots into it as a *candidate generator*:

- **`training_examples`** is the flywheel's store: a `machine_output` /
  `human_output` pair, `engines` jsonb, `source_function`, `corrector_role`
  (`native_speaker` | `content_reviewer` | `admin` | `auto_repair`) and a
  `tier` (`gold` human / `silver` admin / `bronze` automated). It was built for
  exactly this shape.
- **`dialect_native_reviews`** is the queue reviewers already work in, on the
  admin dialect-rules tab, with a settle trigger.
- **`user_roles`** already carries `content_reviewer`, `transcriber` and
  `beta_tester`, and `useAdminAuth` already collapses them into a role the
  router can gate on.

So the feature is: **M3 drafts, a human contributor accepts or corrects, and
the pair lands as a `gold` training example.**

```
contributor pastes/receives text
        │
        ├─► humain-translate  ──► askBrain({ models: [HUMAIN_M3], strategy: 'solo' })
        │        returns candidate + msaLeaks + validator verdict
        │
        ├─► contributor edits in place (unsaved-draft state, as the transcript editor does)
        │
        └─► record-translation-review (service role)
                 ├─ accepted unchanged → training_examples, tier gold, machine == human? skip
                 ├─ edited            → training_examples { machine_output: M3 draft,
                 │                        human_output: the edit, corrector_role:
                 │                        'content_reviewer', engines: { model: 'humain/humain-m3' },
                 │                        source_function: 'humain-translate', tier: 'gold' }
                 └─ rejected/flagged  → dialect_native_reviews { source: 'contributor' }
```

Two things to keep from the existing patterns rather than reinvent:

- **The write goes through an edge function under the service role, and the
  diff is computed server-side against what is actually stored.** That is the
  `transcript-review` rule, and its reasoning applies verbatim: an audit trail
  its own subject can author is worth nothing. A contributor must not be able
  to post a `machine_output` of their choosing — the M3 draft the pair is
  measured against has to be the one the server issued. Persist the candidate
  (or a hash of it) when `humain-translate` returns it and look it up on write.
- **Contributors are not learners.** Gate the route on `content_reviewer` (or
  `beta_tester` for a wider trial), not on subscription tier.

Skip the `bronze` lane here: M3-vs-repair-pass pairs are already covered by
`trainingExampleLogger`, and the value of this surface is the human half.

---

## 3. Database schema changes

**None required for v1.** Checked, one by one:

| Table | Verdict |
| --- | --- |
| `training_examples` | fits as-is. `engines` jsonb carries the model id, `source_function` the origin, `corrector_role`/`tier` the provenance. `task_type` already includes `'translation'`. |
| `dialect_native_reviews.source` | plain `text NOT NULL DEFAULT 'manual'` — the enum lives in a comment, not a `CHECK`. `'contributor'` needs no migration. |
| `llm_usage_logs.provider` | plain `text`, added by `20260812101000_llm_usage_cost_columns.sql`. `'humain'` needs no migration. |
| usage counters | `increment_usage_counter(_user_id, _key, _amount)` is generic over a text key. A new cap key needs no migration. |
| `user_roles` / `app_role` | reuse `content_reviewer`. A new enum value would cost **two** migration files plus `rbac.ts`, `useAdminAuth`, generated types, `personas.ts`, `server/rpc.ts` and the route manifest — not worth it here. |

The one schema change worth *considering* later, and deliberately deferred: a
`translation_candidates` table, if the contributor queue ever needs assignment,
claiming, or two-reviewer agreement. Until then the candidate can live in the
response and the pair in `training_examples`; adding a queue table before there
is a queue buys nothing and costs a migration plus a generated-types drift
entry.

---

## 4. API route structure

Two new edge functions, both following the existing conventions exactly
(`getCorsHeaders(req)` from the `ALLOWED_ORIGINS` allow-list, never `*`;
`serve()` at module scope; `enforceDailyCap` before any model call).

**`POST /functions/v1/humain-translate`**

```jsonc
// request
{ "text": "...", "dialect": "Gulf" | "Egyptian" | "Yemeni",
  "direction": "ar-en" | "en-ar", "mode": "candidate" | "compare" }

// response
{ "candidate": { "arabic": "...", "literal": "...", "natural": "..." },
  "candidate_token": "…",      // server-side handle on the draft, for the write below
  "_meta": { "model": "humain/humain-m3", "provider": "humain",
             "msaLeaks": [], "validator": { "verdict": "pass", "score": 4 },
             "latencyMs": 1840 } }
```

Go through `askBrain` with `models: [MODEL_IDS.HUMAIN_M3]` and
`strategy: 'solo'`, not a bare `chatFetch` — that is how the call inherits the
dialect identity block, the worked demonstrations, the MSA-leak scan and the
usage logging, which are the whole point of the Brain. Set `callTimeoutMs`
explicitly (the preview tier is slow) and `skipRepair: false` so a leaky draft
is repaired before a human is asked to judge it.

`mode: "compare"` is worth building on day one and costs almost nothing: run
the existing `TRANSLATION` lineup alongside M3 and return both, unlabelled or
labelled by preference. That turns the contributor tool into the evaluation
harness for the decision in §1b — human preference data on real content, which
the golden-set leak rate cannot give you.

**`POST /functions/v1/record-translation-review`**

`{ candidate_token, action: 'accept' | 'edit' | 'reject', corrected_text?, notes? }`
→ resolves the token to the stored draft, computes the diff server-side, writes
`training_examples` or `dialect_native_reviews` under the service role. Returns
`{ ok, training_example_id? }`.

**Repo obligations these two incur** (the drift guards will fail the build
otherwise, and they fail on *adding* code, not on breaking it):

- a file per function dir in `supabase/functions/_test/` — `edgeFunctionCoverage`
  checks the names, `npm run test:edge` runs them via `loadFunction()`;
- `[functions.<name>] verify_jwt` in `supabase/config.toml`;
- `HUMAIN_API_KEY` in the edge harness. Add it to `FIXTURE_ENV` only if you
  want M3 routable in every edge test — the Jais precedent (key present,
  endpoint id absent, so `tryChatRoute` returns null by default and tests opt
  in) is the better default here too;
- add `HUMAIN_API_KEY` to `NO_AI_PROVIDER` if M3 ever becomes a path a test
  needs to prove is dead — "the AI is not configured" means *every* provider
  key unset.

---

## 5. Client-side UI

- **Reuse, don't rebuild.** `TranslationPair`, `TappableArabicText`,
  `AskAISentence` and the `useTranslateText` hook shape already do this job on
  `/translate`. A new `useHumainTranslate` hook mirroring `useTranslateText`
  needs a co-located test (`hookCoverage` guard) and keeps the page thin.
- **A new route costs two manifest entries**: `src/test/support/routes/manifest.ts`
  (`routeManifest`) and an in-app link or a `NO_LINK_NEEDED` entry with a
  written reason (`routeReachability`). A contributor tool reached only from
  the admin nav is the normal case for the second.
- **Label the provenance.** An M3 draft is a candidate, not app-quality dialect
  content — a "HUMAIN M3 · draft" chip, and the leak/validator verdict from
  `_meta` shown next to it, so a contributor knows what the machine already
  suspects about the line it is asking them to bless.
- **Keep the draft and the edit distinct in state.** The pair is the
  deliverable; a UI that mutates the candidate in place destroys the
  `machine_output` half. The transcript editor's on-device draft with a visible
  "not saved yet" state is the pattern to copy.
- **Side-by-side for `mode: "compare"`**, with the two outputs order-randomised
  and unlabelled until a choice is made. Labelled comparisons measure brand
  preference, not translation quality.
- **Degrade, don't error.** When `HUMAIN_API_KEY` is unset the function should
  answer a clean "not configured" that the page renders as a disabled panel —
  the same shape `isCappedError` handling already gives the translate page.

---

## 6. Cost and rate limiting

- **Cap it like every other model call**: `enforceDailyCap(req, 'humain-translate', N, corsHeaders)`.
  For a contributor tool set `N` generously (100–200/day) — a call that
  produces a reviewed training pair is worth far more than a learner-facing
  generation. If it ever reaches learners, use the `TierLimits` overload so the
  cost sits inside what the higher tier buys, exactly as image generation and
  jingles do.
- **No OpenRouter safety net.** `canFallBack` is false for M3 by construction,
  so an M3 outage is a hard failure on any path that has only M3. Every
  consumer above is therefore *additive*: a validator leg, an extra drafter, an
  opt-in contributor surface. Nothing on a learner's critical path should have
  M3 as its only route.
- **429 stays un-fallen-back.** The gateway deliberately excludes 429 from
  `FALLBACK_STATUSES`, so a preview-tier rate limit surfaces as a rate limit
  instead of quietly spending another provider's quota. Keep it that way and
  render it as "busy, try again" rather than retrying.
- **Bound the latency explicitly.** Pass `callTimeoutMs` on every M3 call and,
  on the validator ladder, the existing cold-bail ceiling. "Added latency" on a
  preview endpoint plus an unbounded call is how a contributor tool becomes a
  spinner.
- **Spend telemetry**: `logLlmUsage` writes `provider: 'humain'` with whatever
  `usage` block the response carries. If Node reports no cost, `cost_usd` lands
  null and the admin cost view under-reports M3 silently — the sinks swallow
  their own errors by design, which also means they can stop working quietly.
  If cost is absent, price it from token counts in `llmUsageCore.ts` rather
  than leaving the column null.
- **Watch the ensemble multiplier.** Adding M3 to `TRANSLATION` multiplies
  every translation by a third full generation. The validator leg, by contrast,
  is one short classification call on a fraction of requests. Start where the
  cost is bounded.

---

## Suggested order of work

1. Gateway + registry seam, with `HUMAIN_API_KEY` unset in prod. Nothing
   changes; `tryChatRoute` returns null everywhere. One edge test that a
   `humain/` id with no key is unroutable, one that it routes to Node with a
   key — mirroring the RunPod tests.
2. Set the key in a staging project. Run `eval-dialect-live --compare` per
   dialect and record the numbers in this file.
3. Validator tie-break leg. Bounded, optional, reversible.
4. `humain-translate` + `record-translation-review` + the contributor page,
   gated on `content_reviewer`, with `mode: "compare"` on from the start.
5. Revisit the `TRANSLATION` lineup once §2's comparisons and §3's eval agree.

## Sources

- <https://www.unite.ai/pif-backed-humain-launches-humain-m3-arabic-model-at-leap-riyadh/>
- <https://www.techtimes.com/articles/326703/20260904/humain-launches-humain-m3-saudi-arabias-arabic-ai-runs-chinese-weights-scores-unverified.htm>
- <https://ai-tldr.dev/releases/humain-m3/>
- <https://node.humain.com/>
