# HUMAIN M3 — integration plan

Status: **partly implemented**, written 2026-09-08 and revised 2026-09-13
against HUMAIN Node's own API specification.

§1a (the gateway seam) and the validator leg from §1b are built. Everything
from the contributor surface onward is still a proposal. Where this document
guessed and Node's spec later said otherwise, the spec wins and the text below
has been corrected rather than left standing.

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

This document originally listed four facts it had guessed at. Node's API
specification has since settled three of them:

- **Base URL**: `https://api.node.humain.com/v1`, with `/healthz` on the origin
  outside it. Confirmed live — an unauthenticated `GET /v1/models` returns 401
  `missing_api_key` in Node's documented error envelope, with an
  `X-Request-ID` header.
- **Auth**: `Authorization: Bearer $HUMAIN_NODE_API_KEY` (or `x-api-key`).
  Note the variable name: this plan first invented `HUMAIN_API_KEY`, and the
  code uses Node's own name instead.
- **Reasoning**: Node's `/chat/completions` documents the optional fields it
  takes, and neither `reasoning` nor `reasoning_effort` is among them.
  `max_tokens` and `temperature` are, which is what the Brain's bodies set. So
  M3 is sent no reasoning field, and that is now a fact rather than caution.

One remains, and it cannot be looked up:

- **The served model id.** Node's catalogue is *per key* — availability is
  assigned per user across four tiers, one of them early-access preview — so
  there is no global answer to "what is M3 called". Node's own instruction is
  to call `GET /v1/models` first. `scripts/humain-models.ts` does that and
  prints the ids, without the key touching this repo or a chat window:

```sh
HUMAIN_NODE_API_KEY=... deno run --allow-env --allow-net scripts/humain-models.ts
```

  `MODEL_IDS.HUMAIN_M3` currently reads `humain/humain-m3`, which is a
  placeholder until that list confirms it. A wrong id is a 404
  `model_not_found`, which on the validator leg is one degraded gate rather
  than a broken request — see §1b.

Node also exposes `/responses`, `/messages` (Anthropic-shaped), image
generation and a realtime WebSocket on the same key. None of them are used
here: `/chat/completions` is the shape `aiGateway` already speaks, and the
others are only interesting if M3 ever takes on a job those endpoints serve.

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

**`_shared/aiGateway.ts`** — six small edits, each mirroring the Fanar case
that is already there:

| Site | Change |
| --- | --- |
| `Provider` union | add `'humain'` |
| `humainChatUrl()` | `HUMAIN_BASE_URL` (default `https://api.node.humain.com/v1`) + `/chat/completions` |
| `HUMAIN_MODEL` regex | `/^humain\//` → `vendorForModel` returns `'humain'` |
| `keyFor` / `KEY_ENV` / `CHAT_URLS` | `HUMAIN_NODE_API_KEY` |
| `upstreamModelId` | strip the `humain/` prefix |
| `hasAnyProvider` | add the HUMAIN key — see below |
| `canFallBack` | unchanged — stays false, which is the point |

A missing `HUMAIN_NODE_API_KEY` then makes `tryChatRoute` return `null`, which is
already the codebase's word for "unconfigured provider, skip silently". That
is what lets every consumer below ship dark and light up when the secret lands.

`hasAnyProvider` is the one that is easy to miss and fails loudly. It reads
`Boolean(googleApiKey() ?? openaiApiKey() ?? openRouterApiKey())`, and
`askBrain` calls it as a preflight before any model resolution happens —
throwing `No AI provider configured` and naming those three secrets. A
deployment whose only key is HUMAIN would therefore fail *before* the route
that would have served it was ever built, which is exactly the shape
`humain-translate` takes below (solo M3 through the Brain). Add the key to
the check and to the message it prints.

Worth saying plainly: this is a pre-existing gap rather than one M3 creates —
a Fanar-only or Jais-only deployment fails the same preflight today. It has
gone unnoticed because those two are always additional legs beside a
configured Google or OpenRouter, never the sole provider. M3 is the first
model this plan proposes to call on its own, so it is the first to meet it.

### 1b. Where to actually use it, in the order worth doing

**First: a leg of the dialect validator.** `_shared/dialectValidator.ts` already
runs a Gemini Pro judge, a Mistral Saba Arabic leg, and a tie-break ladder
(Jais 2 8B → Fanar) consulted only when the two standing legs split. Judging
whether a line reads as native dialect is precisely what an Arabic-native
frontier model is for, and this slot is the safest place in the app to test a
new key: the validator is optional by design — it returns `unknown`/`ok:false`
when its provider is unavailable, so a bad key, a rate limit or a slow preview
tier degrades the gate instead of failing the request behind it.

**Built.** M3 sits at the head of the tie-break ladder, ahead of Jais 2, under
the same `tryChatRoute` guard — so ladder position costs nothing when the key
is absent.

One correction to what this section first said, found while implementing it.
It said to put M3 first "under the same `TIEBREAK_COLD_BAIL_MS` /
`TIEBREAK_BUDGET_MS` ceilings", and that would have been a bug. The rungs
share a single `TIEBREAK_BUDGET_MS`, and `arabicRungCeilingMs` (then `tiebreakCeilingMs`) hands everything
that is not our own RunPod worker the run of it — correct for Fanar, a warm
hosted API, and wrong for a model whose own preview terms advertise added
latency. First *and* unbounded, a slow M3 could spend the whole budget and
leave Jais and Fanar unasked: a quality upgrade that makes the split worse.
M3 therefore has a ceiling of its own, `TIEBREAK_PREVIEW_BAIL_MS` (7s, larger
than the 5s cold bail because a slow hosted endpoint plausibly *will* answer
where a cold worker will not). Revisit it once M3's real latency on a
single-snippet judgment is measured.

**Promoted.** M3 is now the standing Arabic leg, and Saba is the fallback
behind it (`ARABIC_STANDING_LEG_ORDER` in `modelRegistry.ts`, resolved by
`arabicStandingLeg()`). What forced the question earlier than this section
planned was an audit of a real run: M3 and Jais were reported as "didn't
fire", and the reason was that nothing in the transcription pipeline can
reach a tie-break rung at all — see 1c below. Fixing that made the roster's
ordering load-bearing, and a tie-break rung that only speaks when Saba and
Gemini Pro happen to disagree is not where the strongest Arabic model in the
registry belongs.

Two consequences worth stating, because neither is free:

- **Read this as a promotion on published benchmarks, not on measured
  latency.** HUMAIN's own eval puts M3 at 89.37% across seven Arabic
  benchmarks against Opus 5's 87.34, which is the quality half of "fast and
  good". The speed half is still unmeasured here — nobody has timed a
  single-snippet judgment against a live key. The standing seat fires on
  *every* validated generation, where the tie-break fired on a minority, so
  the exposure to a slow preview endpoint went up rather than down.
- That is what `STANDING_LEG_PREVIEW_BAIL_MS` (12s) is for. The standing legs
  otherwise take the caller's `timeoutMs`, and the common caller — askBrain's
  review path — passes none, so an unbounded hanging M3 would have spent the
  30s default on every generation in the app. A timed-out Arabic leg reports
  `ok: false` and the cross-check degrades to Gemini Pro alone, which is the
  documented behaviour for any unavailable provider. Tighten or loosen it once
  the real latency is known; that measurement is still the open item.

M3 stays listed first in `ARABIC_OCCASIONAL_ORDER`, but the tie-break filters
out whichever model holds the standing seat — a tie-breaker that is one of the
disagreeing parties is not a third opinion. Its place in that list is now load-
bearing for the *pipeline* consumer instead (1c).

### 1c. The gap this was actually hiding

Adding M3 to the registry changed nothing for transcription, and neither had
adding Jais 2 before it. `analyze-gulf-arabic` ran its per-video dialect check
by calling Fanar directly — a bare `fetch` to `api.fanar.qa` with a hardcoded
model id — so it could not see the registry's roster at all. Neither model was
misconfigured: on the audited run the Jais endpoint had a warm worker and M3's
id and base URL were correct. They were simply unreachable from that code
path, which no test covered because every test of the *validator* passed.

`judgeWithArabicNative()` in `dialectValidator.ts` is the seam that closes it:
it walks `ARABIC_OCCASIONAL_ORDER` through `chatFetch`, returns which model
answered, and records the rungs that failed. The pipeline stores that model in
`engines_used.dialect_signals.fanar_validation.model` and the admin panel names
it, because an audit that cannot tell M3's verdict from Fanar's is how this went
unexamined for as long as it did. The key is still spelled `fanar_validation`
for the sake of historical rows.

The first run after that seam landed (2026-09-13, 17:05 UTC) still reported
the dialect check as "Fanar, replied in prose" and nothing from M3 or Jais, and
it took a second look to see why. Three things, each fixed in the walk:

- **A prose reply ended the walk.** `judgeWithArabicNative` took the first
  non-empty reply as the answer, so one chatty rung meant nothing behind it was
  asked. It now takes an `accept` predicate — the pipeline passes "does the
  issue parser get anything out of this" — and a rung that fails it is a
  failed attempt like a 503. When every rung is prose the first prose is still
  returned, marked `usable: false`, so the admin banner keeps something to
  show. The dialect-check prompt also gained a one-line English "JSON only"
  instruction under its Arabic brief; every model on the roster follows an
  English format rule more reliably than an Arabic one.
- **The rungs that failed were invisible whenever a later one answered.** The
  walk recorded them in `attempts`, and the pipeline only logged that list when
  *nobody* answered. A run where M3 404s and Fanar replies looked identical to
  one where M3 was never configured. `attempts` is now logged on every run and
  stored under `fanar_validation.attempts` (and `translation.arabic_arbiter.attempts`),
  so "M3 didn't fire" is answered from the row: `HTTP 404 model_not_found` is
  a key whose tier lacks the model; a timeout is the preview latency.
- **The cold probe was aborting a warm Jais.** The 8s cold bail sat on the
  whole call, and vLLM sends a non-streaming completion's headers only when
  the body is finished — so an 8B model writing a thousand tokens of JSON about
  a transcript was cut off at eight seconds whether the worker was hot or not.
  The bail now bounds a one-token *probe*; a worker that answers it is awake
  and the real call gets the full budget. And since the endpoint scales to zero
  after five idle minutes, the pipeline pings it at the top of every run
  (`warmArabicJudges`, `JAIS_PIPELINE_WARMUP`), which is roughly a FlashBoot
  start ahead of the first question.

**What the second run said (2026-09-14, video `41bf72a9`).** With the walk
fixed, both judges were *asked* and both missed, for reasons the row now
names:

- M3: `HTTP 400 Unsupported model: humain-m3`. The id is the one Node's own
  docs use, so this is the catalogue question §0 warned about — access to M3
  is granted per account and this key does not carry it under that name, or at
  all. The gateway now answers that question itself: on a model refusal it
  reads `GET /v1/models` with the same key, retries once under whatever id
  there is M3, and remembers the alias; when nothing there is, the refusal
  stands and the attempt record carries the catalogue (`humainCatalogueSummary`),
  so "request M3 access on HUMAIN Node" is readable from the video.
  `HUMAIN_M3_MODEL_ID` pins the id outright.
- Jais: `cold worker: no answer to a 1-token probe in 8000ms` — despite the
  run-start ping. The RunPod endpoint was checked live while that worker came
  up: started 04:32:27Z on the ping, not ready until roughly seven to nine
  minutes later. It has no network volume, so a cold start is a 16GB pull from
  the Hub plus vLLM's load, and no pipeline run lasts that long. The ping is
  therefore what makes the *next* run within the five-minute idle window warm,
  not this one. Making Jais answer on a first run is infrastructure, not code:
  a network volume holding the HF cache (a load from disk rather than a
  download) and/or a longer idle timeout so a session of imports shares one
  boot. Both cost money and are the operator's call.

**What the third run said (2026-09-14, 05:42 UTC, a Yemeni clip).** The
catalogue lookup worked: Node refused `humain-m3`, the gateway retried as
`humain-m3-preview` and M3 answered — with a 200 whose text this code did not
read, so the row said "empty response body". Jais was awake this time, judged
the dialect check in "prose-wrapped JSON the parser wouldn't accept", and then
did the translation arbitration on its own: seven disputed lines in, seven
resolved, eleven seconds. Fanar's dialect check was refused by its own content
filter (400). Two fixes in the reader, one in the prompt:

- `completionText` now reads the OpenAI content-*parts* shape
  (`content: [{type: "text", text}]`) as well as the string. M3 is natively
  multimodal, and that is the shape a multimodal endpoint is entitled to
  answer in. When a reply is still empty the attempt record says why
  (`describeEmptyCompletion`: finish reason, any refusal, the keys the message
  carried), so a guardrail block and an unread shape stop looking alike.
- `parseDialectIssues` accepts field names translated into Arabic
  (`الكلمة`, `النوع`, `الشدة`, …) and a wrapper key such as `المشاكل`; reads
  Python-style single-quoted JSON; and salvages the finished issue objects out
  of a reply cut off by its token budget, since a truncated list of real
  findings is a real answer. The dialect-check budget went to 2048 tokens and
  the prompt now asks for notes under twelve words with the field names kept
  in English — a smaller Arabic model translates the keys as readily as the
  values when asked in Arabic.

**What the fourth run said (2026-09-14, 06:55 UTC, a Gulf clip).** Both
judges reached, both refused, both reasons on the row:

- M3, retried correctly as `humain-m3-preview`, answered
  `finish_reason=content_filter` with a `refusal` — the second run in a row,
  on ordinary spoken Gulf and Yemeni. That is the limited preview's Saudi
  alignment guardrail doing what its terms say it does, and nothing in this
  codebase changes it: the tier without the guardrail is the *research
  preview*, which is a further approval on the HUMAIN Node account. Until
  then M3's contribution to transcripts is bounded by what the guardrail lets
  through. One saving is made here: a model that refused the transcript in the
  dialect check is not asked again for the arbitration (`refusedOnContent` →
  `skip`), since a refusal is a verdict about the text.
- Jais answered `HTTP 502` — an HTML page from the load balancer, not a model
  reply — to the probe about ninety seconds after the run-start ping. Checked
  live afterwards: the worker that ping started became ready roughly seven
  minutes later, and RunPod had also started a *second* worker on a Blackwell
  MIG slice (the endpoint's 24GB pools admit it) that was still initialising
  two hours on. A 502 while no worker is ready is the cold start again, just
  faster to fail; the probe now records it as "worker not ready" so the row
  says starting rather than broken. The remedies were infrastructure, and
  they were applied the same day: a 40 GB network volume for the weights in
  `US-IL-1`, a 30-minute idle timeout, and the MIG slice excluded from the
  pools — see `docs/deployment.md`. Whether that brings a cold start inside a
  pipeline run is the next thing to measure.

### 1d. A say in the translations

`analyze-gulf-arabic` also now puts every line its ensemble could not settle to
the same roster, before the Shaheen-MT rendering. The ensemble's three
drafters are generalists judging each other by English token overlap, and the
only tiebreak was an MT model's rendering scored the same way — on the audited
run that reached four of eight disputed lines and settled none. The roster is
asked outright instead: the Arabic line and the lettered, *unnamed* candidates
(a judge told which is Claude's measures brand preference), and a JSON verdict
per line with a confidence. A high-confidence pick becomes the line and clears
`needs_review`, recorded as `resolved_by: humain/humain-m3→<candidate model>`;
a low-confidence pick becomes the line but stays flagged; a null pick leaves the
line as the ensemble had it. Only what is still open goes on to Shaheen, which
is what keeps that call inside its twenty-a-day allowance. The prompt, the
layout and the tolerant parser are `buildArbiterSystemPrompt`,
`formatDisputedLines` and `parseArbiterChoices` in `_shared/translationArbiter.ts`;
the outcome is `engines_used.translation.arabic_arbiter`, which the admin
provenance panel reads.

The judge role has a limit the sixth run made plain: only a *dispute* reaches
it. A 5-line clip where Claude, Gemini and Qwen agreed on every line went
through with M3 never shown a word of English, and three generalists can
agree on the same misreading of a Gulf idiom as fluently as on a right one.
Unanimity was standing in for correctness on exactly the lines the roster
exists to catch.

**Second, built: a drafter in the transcript ensemble, at the peers' weight
(2026-09-14, by decision rather than behind the eval below).** M3 is the
third entry in `TRANSCRIPT_TRANSLATION_DRAFTERS` and carries `1.0` in
`MODEL_WEIGHTS`, so `mergeOneLine` treats it exactly as it treats Claude and
Gemini: any two of the three agreeing settles a line, and one of them reading
a line differently from the other two is outvoted, not a veto. That last
point is deliberate — flagging every M3 dissent would put every paraphrase
below the 0.6 Jaccard line on the review queue — so the dissent is recorded
instead: each tier's `lines_outvoted` in `engines_used.translation` counts the
lines a drafter answered and lost, and the admin provenance panel shows it.
A run where M3 is outvoted on a third of the lines is the signal to look at
those lines by hand and, if M3 was right, to revisit the weights.

Three consequences of drafting, each handled:

- **M3 no longer arbitrates a dispute it drafted in.** A judge that is one of
  the disagreeing parties picks itself. `analyze-gulf-arabic` batches the
  disputed lines by which roster drafters supplied a candidate on them and
  walks the roster once per batch with only those parties skipped (recorded
  in the row as `skipped: drafted in this ensemble`), so a dispute M3 drafted
  goes on to Jais 2 and Fanar, while a line M3's partial reply never covered
  still gets M3 as its judge. On a full reply that is one batch. The dialect
  check is unaffected — M3 still leads it.
- **No key, no rung.** The drafter list is filtered by `tryChatRoute`, so a
  deployment without `HUMAIN_NODE_API_KEY` runs the three-model ensemble it
  always did, with no failed M3 row in its provenance. `degraded` and the
  admin panel's "N of M models answered" are measured against
  `configured_models`, the drafters that deployment asked for — so a
  configured M3 that fails is visible, and three of three is healthy.
- **Cost and latency.** One more full translation per video, and the
  ensemble now finishes when its slowest drafter does. On the limited preview
  a Saudi guardrail refusal is a failed rung the vote proceeds without; on the
  22-line Gulf clip it refused in the dialect check, it would have refused
  here too. Research-preview access is what makes the fourth seat reliable.

Not changed: `MODEL_LINEUPS.TRANSLATION`, which serves every other translation
caller through the Brain, stays `[CLAUDE, GEMINI_FLASH]`.

**The eval this still owes.** `runEnsemble` ranks candidates by weighted
Jaccard agreement and MSA leak count, so adding a drafter needed no new
machinery — one array entry plus a weight. What it needed was evidence, and
the repo has one instrument for a neighbouring question:

```sh
HUMAIN_NODE_API_KEY=... OPENROUTER_API_KEY=... deno run --allow-env --allow-read --allow-net \
  scripts/eval-dialect-live.ts --model humain/humain-m3 --compare anthropic/claude-sonnet-5
```

That runs the frozen golden set through the same dialect prompt the Brain
builds and prints the per-dialect leak-rate delta. Run it per dialect — the
interesting question is not "is M3 better at Arabic" (it will be) but "is it
better at *Gulf, Egyptian and Yemeni* than a model that is already paid for",
and a Saudi-commissioned model has an obvious prior toward Gulf and an
unexamined one on Yemeni. Ship the lineup change only if the delta is real.
That measures Arabic *generation* leak rate, which is not the fidelity of a
dialect-to-English rendering. The right instrument for the promotion is the
review tables: `transcript_line_revisions` holds lines where a native speaker
corrected the pipeline's English. Rerun those Arabic lines through each
drafter, score each against the human correction per dialect (the Yemeni
split matters most — a Saudi-commissioned model has an obvious prior toward
Gulf), and let the weights follow the numbers. Until that is run, the 1.0 is
a decision about whose reading deserves an equal vote, not a measurement.

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
- **`user_roles`** already carries `content_reviewer` and `transcriber`, and
  `useAdminAuth` collapses those into a role the router can gate on. Note that
  `beta_tester` is **not** one of them: `UserRole` in `useAdminAuth.ts` is
  `admin | content_reviewer | recorder | transcriber | null`, `checkRoles()`
  never queries the beta role, and `AdminLayout` does not count it as
  privileged. A beta-tester-only account resolves to no role and cannot reach
  an admin-nav surface at all. So this feature is `content_reviewer`-gated,
  full stop; widening it to beta testers later is its own change to
  `useAdminAuth` and the layout's gate, not a config flip.

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
                                        (see the trigger caveat below)
```

**The rejection lane has a label bug waiting in it.** When a row in
`dialect_native_reviews` is later settled as `corrected`, the
`training_example_from_review()` trigger mirrors it into `training_examples`
with `task_type` hardcoded to `'generation'`. A rejected M3 *translation* that
a native speaker then fixes would therefore land labelled as a generation
pair, quietly contaminating any export that filters by task. Three ways out,
in order of preference:

1. Don't route translation candidates through that trigger at all — have
   `record-translation-review` write the `training_examples` row itself with
   `task_type: 'translation'`, and use `dialect_native_reviews` only as the
   human queue.
2. Teach the trigger to derive the task from `NEW.source` or `NEW.metadata`.
   This is correct but costs a migration, which is the one place §3's "no
   schema change" claim does not hold — see the note there.
3. Accept the mislabel. Not an option: the whole value of these rows is that
   an export can be filtered to one task.

Two things to keep from the existing patterns rather than reinvent:

- **The write goes through an edge function under the service role, and the
  diff is computed server-side against what is actually stored.** That is the
  `transcript-review` rule, and its reasoning applies verbatim: an audit trail
  its own subject can author is worth nothing. A contributor must not be able
  to post a `machine_output` of their choosing — the M3 draft the pair is
  measured against has to be the one the server issued.

  This is the invariant that decides `candidate_token`'s design, and the repo
  offers nothing to build it from: there is no candidate store and no signing
  helper anywhere in `supabase/functions/`. Two honest options, and a v1 must
  pick one rather than leave the token unexplained:

  - **A signed self-contained token.** `humain-translate` returns an HMAC over
    `{ draft, dialect, user_id, issued_at }` signed with a new secret; the
    write endpoint verifies the signature and an expiry before trusting the
    draft. No table, so §3's "no migration" holds — at the cost of a new
    secret and a token big enough to carry the draft.
  - **A candidate table.** `translation_candidates` keyed by id, with
    `user_id`, the draft, and an expiry; the token is just the row id. Simpler
    to reason about and the natural home if the queue later needs claiming,
    but it is a migration and a generated-types entry.

  Either way, do **not** let the client hand back the draft it was shown. That
  is the one shape that voids the invariant entirely.
- **Contributors are not learners.** Gate the route on `content_reviewer`, not
  on subscription tier — and see the `beta_tester` note above for why that is
  not a drop-in alternative.

Skip the `bronze` lane here: M3-vs-repair-pass pairs are already covered by
`trainingExampleLogger`, and the value of this surface is the human half.

---

## 3. Database schema changes

**None required for the storage of the pairs themselves** — but "none at all"
is only true for one of the choices left open above. Two decisions in §2 each
carry a migration on one branch: the `candidate_token` store (a signed token
avoids it; a `translation_candidates` table does not), and the rejection lane's
`task_type` (writing the row from the edge function avoids it; teaching
`training_example_from_review()` does not). Take the migration-free branch of
both and this section holds as written; take either other branch and budget a
migration plus a generated-types drift entry. The compare-mode record below is
a third, and it has no migration-free branch.

The tables the feature actually writes, checked one by one:

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

`mode: "compare"` is worth building on day one: run the existing `TRANSLATION`
lineup alongside M3 and return both, unlabelled. That is what turns the
contributor tool into the evaluation harness for the decision in §1b — human
preference data on real content, which the golden-set leak rate cannot give
you.

It is *not* free, though, and the flow as drawn in §2 would throw the data
away. A preference is a fact about a pair — which candidate won, which lost,
which model produced each, and what order they were shown in — and none of
that survives a write that records one `candidate_token` and one action. Worse,
the most decisive outcome of all is an accept with no edit, which §2 skips as
a no-op because `machine_output == human_output` makes a useless training pair.
It is a useless *training* pair and the strongest possible *preference*
signal.

So compare mode needs a record of its own: a comparison id issued with the two
drafts, carrying both model ids and the display order, and a selection written
on every resolution including unchanged accepts. There is no existing table
for this and no way to fold it into `training_examples`, whose row is a pair
and not a choice — so unlike the rest of §2, this one costs a small table. If
that is not wanted in v1, ship compare mode as display-only and say so, rather
than claiming an evaluation harness that records nothing.

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
- `HUMAIN_NODE_API_KEY` in the edge harness. Add it to `FIXTURE_ENV` only if you
  want M3 routable in every edge test — the Jais precedent (key present,
  endpoint id absent, so `tryChatRoute` returns null by default and tests opt
  in) is the better default here too;
- add `HUMAIN_NODE_API_KEY` to `NO_AI_PROVIDER` if M3 ever becomes a path a test
  needs to prove is dead — "the AI is not configured" means *every* provider
  key unset.

---

## 5. Client-side UI

- **Reuse, don't rebuild.** `TranslationPair`, `TappableArabicText`,
  `AskAISentence` and the `useTranslateText` hook shape already do this job on
  `/translate`. A new `useHumainTranslate` hook mirroring `useTranslateText`
  needs a co-located test (`hookCoverage` guard) and keeps the page thin.
- **A new route costs two manifest entries and one allow-list**:
  `src/test/support/routes/manifest.ts` (`routeManifest`), an in-app link or a
  `NO_LINK_NEEDED` entry with a written reason (`routeReachability`), and —
  the one a manifest entry does not buy you — the path itself in
  `CONTENT_REVIEWER_ALLOWED_ADMIN_PREFIXES` in `src/lib/rbac.ts`.
  `AdminLayout` admits a content reviewer only where
  `canAccessContentReviewerAdminPath()` returns true, and that function matches
  against a fixed prefix list (`/admin/videos`, `/admin/set-phrases`,
  `/admin/dialect-rules`, …). Without an entry there, the intended
  contributors are redirected away from a route the manifest happily declares
  reviewer-accessible.
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
- **Degrade, don't error.** When `HUMAIN_NODE_API_KEY` is unset the function should
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
- **Watch the ensemble multiplier.** M3 now drafts in the transcript
  ensemble (§1d), one more full generation per video. It is *not* in
  `TRANSLATION`, the Brain lineup every other translation caller uses; adding
  it there would multiply every translation in the app by a third generation.
  The validator leg, by contrast, is one short classification call.

---

## Suggested order of work

1. Gateway + registry seam, with `HUMAIN_NODE_API_KEY` unset in prod. Nothing
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
