# AI spend: what every call costs, what a learner costs, and where to cut

*2026-10-10. Prices checked that day against the vendors' pages and
OpenRouter's live model list; every token count is an assumption and is
labelled as one. The model that produced the tables is reproducible from the
"Assumptions" section at the end.*

## The short version

- **The plans do not cover the usage they advertise.** A Standard subscriber
  nets **$4.55** a month after Stripe; a learner who uses the app on twenty
  days costs about **$28** today and about **$15** after the fixes below. The
  two hours of live voice Standard promises cost **$6.17** on their own if
  used; All-In's five hours cost **$15.41**, the whole plan price. A plan
  covers roughly **six active days** of typical use, not a month.
- **The single biggest line is pictures, and it is a bug, not a product
  decision.** The shared asset store (`word_assets`, migration
  `20261009130000`) is **not applied on the live project** — the table is
  missing from `types.ts` and sits in the `typesDrift` pending list — so
  every quiz picture is drawn fresh for every learner on every session at
  $0.067, served once and never stored. The code to share them is written
  and tested; it is waiting on the migration. Apply it and pictures fall from
  the #1 line to a rounding error.
- **Paid tiers bypass most caps entirely.** Of the 75 cap call sites (on 73
  functions), 13 carry a per-tier ceiling and four are subscriber-only
  gates; on the other 58 a subscriber is unlimited. The
  worst-case daily spend of one All-In learner is unbounded on chat,
  how-do-i-say, stories, listening episodes and meme analysis.
- **Gemini Flash doubles in price on 2027-01-01.** Google's pricing page
  lists the Flash tier (3.8 Flash; the registry's 3.7 is no longer on the
  page) at $0.75 / $3.75 per Mtok as promotional through 31 December 2026,
  with $1.50 / $7.50 after. OpenRouter serves 3.7 at the same rate today. Flash is the model behind most
  of the app's Arabic; budget for every Flash line below to double in twelve
  weeks unless the registry moves.
- **Build the library.** Filling the whole authored curriculum with pictures
  once costs about **$56** (or **$28** on Google's batch tier). Today the app
  spends that much on pictures for roughly **seven** typical subscribers in a
  month.
- **Revisit before launch.** §8 is the launch gate: four decisions (the
  store, the voice allowance, which tutor each tier gets, the price points),
  the lean configuration and a proposed cap table. Nothing in it is applied
  yet.

## 1. What costs money

Everything model-shaped goes through `_shared/aiGateway.ts`, with prices set
by the vendor of the id in `_shared/modelRegistry.ts`. The paid surfaces:

| Surface | Provider / model | Billed how | Price used |
|---|---|---|---|
| Sonnet (chat, judge, drafter, repair) | `anthropic/claude-sonnet-5` via OpenRouter | per token, prompt cache on the dialect prefix | $2 in / $10 out / $0.20 cached, per Mtok |
| Flash (the UTILITY lineup and most Arabic) | `google/gemini-3.7-flash` via Google | per token, reasoning floored at "low" (billed as output) | $0.75 / $3.75 / $0.075 cached — **$1.50 / $7.50 from 2027-01-01** |
| Pro (validator's strong leg, free-chat, bible) | `google/gemini-3.1-pro-preview` | per token | $2 / $12 |
| Luna (story critic, live-voice backend) | `openai/gpt-5.6-luna` | per token | $0.20 / $1.20 / $0.02 cached |
| Qwen Max (meme, curriculum chat) | `qwen/qwen3.8-max-0902` via OpenRouter | per token, reasoning mandatory | $2 / $6 |
| Saba (fallback Arabic leg) | `mistralai/mistral-saba` via OpenRouter | per token | $0.20 / $0.60 |
| HUMAIN M3 (standing Arabic leg, chat native review, transcript drafter) | HUMAIN Node | **unpublished** — Node prices per model and the page is behind a login | placeholder $0.50 / $1.50; read it off Node's console |
| Fanar (occasional Arabic judge, meta enrichment) | QCRI | free research API, **rationed** by a small daily allowance | $0 |
| Jais 2 8B (RunPod) | self-hosted, **paused** since 2026-09-18 | GPU-hour | $0 while off; the HF-cache volume still meters $0.05–0.09/day |
| Pictures | `google/gemini-3.1-flash-image` (OpenAI `gpt-image-2` fallback) | per image | $0.067 per 1K square (batch $0.034) |
| Clips (quiz Phase 5) | `google/veo-3.1-lite` | per second, 720p | $0.05/s (Google, audio forced) or $0.03/s (OpenRouter, silent) |
| Jingles, celebration songs | `lyria-3-clip-preview`, Google only | per 30 s clip | $0.04 |
| Live voice, default engine | OpenAI `gpt-live-1` | per minute, metered per second, **plus** the backend text model and tools | $0.05/min + Luna tokens |
| Live voice, rollback engine | OpenAI `gpt-realtime-2` + `gpt-4o-transcribe` | per audio token | $32 / $64 per Mtok audio; transcribe $0.006/min |
| TTS | Munsit (primary), ElevenLabs (Egyptian rung), Azure (emergency) | Munsit 2 credits/char; ElevenLabs $0.08/1K chars; Azure $15/1M chars | Munsit at ~$0.035 per 1K credits (Build/Starter plans) |
| ASR for scoring and uploads | Munsit (primary), Soniox, Deepgram, Fanar | Munsit 1,000 credits/min; Soniox $0.10/h; Deepgram nova-3 $0.0052/min | |
| Pronunciation scoring | Azure Speech pronunciation assessment | per hour of audio | ~$1.30/h ($1 STT + $0.30 add-on) |
| Retrieval | OpenAI `text-embedding-3-small` | per token | $0.02 per Mtok |
| Morphology | Farasa (QCRI) | free | $0 |
| Not AI, still metered | YouTube Data API, Stripe (2.9% + $0.30), Supabase storage/egress, Netlify | | not modelled here |

Two routing facts shape the bill. First, the Brain's strategies multiply
calls: `solo` is one generation; `ensemble` is two in parallel (Sonnet +
Flash) and keeps the lower-leak one; `draft_critic` is a Flash draft plus a
Sonnet critic only when a quality gate or the native validator asks for it;
`council` is two drafts plus a Sonnet judge. Every strategy may add a Sonnet
**repair pass** when the leak detector fires (assumed on 30% of calls below —
the detector's universal list includes demonstratives ordinary dialect uses,
so it fires often). Second, the **native validator** (`enforceDialect` /
`validateDialect`) is two parallel calls — HUMAIN M3 and Gemini 3.1 Pro — plus
a tie-break rung when they split, so a "validated" generation carries three
models' bills.

Three of the model ids in the registry deserve a check before the next bump:
Google's pricing page no longer lists a *3.7* Flash (it lists 3.8 and 3.6 at
the same price), OpenRouter no longer lists `qwen/qwen3-235b-a22b` (only the
`-2507` snapshots), and `humain/humain-m3` has no public price at all. The
first two still route today; neither will forever.

## 2. What one action costs

Estimates, from list prices and the token assumptions in §7. "∞" means a
subscriber bypasses the cap (`enforceDailyCap` without a `TierLimits` table).

| Action | Est. cost | Free/day | Standard/day | All-In/day | What it is |
|---|---:|---:|---:|---:|---|
| assistant-chat turn | $0.018 | 40 | ∞ | ∞ | Sonnet 5 reply + embedding + tool plan + native review + memory update |
| daily-recap / video-debrief step | $0.016 | paid only | ∞ | ∞ | 3–4 steps per session |
| free-chat (conversation simulator) turn | $0.016 | 30 | ∞ | ∞ | Gemini 3.1 Pro stream + learner-error extraction after the turn |
| ask-translation turn | $0.004 | 40 | ∞ | ∞ | Flash |
| culture-guide turn | $0.013 | 15 | ∞ | ∞ | Sonnet 5 |
| how-do-i-say | $0.041 | 20 | ∞ | ∞ | council: 2 drafters + Sonnet judge + repair ~30% |
| word-enrichment (save a word) | $0.011 | 60 | ∞ | ∞ | ensemble Sonnet + Flash, repair ~30% |
| generate-sample-sentences | $0.013 | 30 | ∞ | ∞ | ensemble, repair ~30% |
| translate-phrase | $0.004 | 30 | ∞ | ∞ | 4 parallel direct calls |
| translate-text | $0.006 | 30 | ∞ | ∞ | solo Flash, no repair |
| grammar-drill | $0.033 | 20 | ∞ | ∞ | ensemble, repair ~30% |
| listening-quiz | $0.061 | 15 | ∞ | ∞ | ensemble + repair ~30% + TTS of the lines |
| souq-news-quiz | $0.033 | 15 | ∞ | ∞ | ensemble |
| phrase-of-the-day | $0.010 | 20 | ∞ | ∞ | ensemble |
| mistake-drill | $0.015 | 30 | 100 | 300 | solo Flash + repair ~30% |
| monologue-prompts | $0.004 | 15 | 60 | 150 | solo Flash |
| writing-coach turn | $0.013 | 10 | 40 | 120 | solo Flash + repair ~30% |
| daily-challenge | $0.015 | 20 | ∞ | ∞ | solo Flash + repair ~30% |
| dialect-compare | $0.008 | 25 | ∞ | ∞ | solo Flash, no repair |
| souq-news (retelling) | $0.061 | 10 | ∞ | ∞ | Firecrawl search + up to 4 articles, each solo Flash + repair ~30%; cached only in the browser |
| reading-passage | $0.038 | 15 | ∞ | ∞ | draft_critic + native validator; critic ~30%, repair ~30% |
| reading-qa | $0.005 | 30 | ∞ | ∞ | direct Flash |
| daily story (on demand or pregenerated) | $0.039 | 5 | ∞ | ∞ | draft_critic + native validator; one per learner per day |
| generate-story (custom) | $0.046 | 10 | ∞ | ∞ | Flash draft, Luna critic ~50%, repair ~30%; cover and video extra |
| story cover image | $0.067 | — | — | — | one picture |
| story video, per scene | $0.092 | — | — | — | picture + narration TTS |
| listen script (episode) | $0.064 | 5 | ∞ | ∞ | two solo Flash calls (8k + 4k max) + repair ~30% |
| listen audio (episode) | $0.175 | 20 | ∞ | ∞ | TTS of a ~2,500-char script |
| generate-worksheet | $0.022 | 3 | 10 | 30 | solo Flash + repair ~30% |
| placement-quiz | $0.007 | 40 | ∞ | ∞ | direct Flash; also anonymous, per IP |
| suggest-flashcards | $0.005 | 15 | ∞ | ∞ | direct Flash |
| extract-grammar-points | $0.006 | 20 | ∞ | ∞ | direct Flash |
| generate-mnemonic | $0.002 | 15 | ∞ | ∞ | direct Flash |
| request-situation-phrases | $0.007 | 20 | ∞ | ∞ | direct Flash |
| set-phrase-quiz | $0.006 | 40 | ∞ | ∞ | direct Flash |
| convert-to-fusha | $0.007 | 40 | ∞ | ∞ | direct Sonnet, Flash fallback |
| analyze-meme | $0.050 | 15 | ∞ | ∞ | ensemble on the image + audio pass + repair ~30% |
| screen-shared-content | $0.006 | 30 | ∞ | ∞ | solo Flash |
| hf-chat turn | $0.014 | 40 | ∞ | ∞ | ensemble |
| enrich-word-roots | $0.004 | 3 | 10 | 30 | solo Flash |
| **quiz picture (word-asset image)** | **$0.067** | 20 | 60 | 200 | one picture; **not shared until `word_assets` is applied** |
| flashcard / mnemonic image | $0.067 | 20 | 60 | 200 | one picture, per learner, never shared |
| word dialogue (word-asset) | $0.011 | 30 | 100 | 300 | draft + native validator + critic ~30%; refused while the table is missing |
| word / phrase jingle | $0.051 | 15 | 40 | 120 | Flash lyrics + Lyria clip, 20% retried |
| celebration song | $0.051 | 3 | 10 | 30 | same shape as a jingle |
| word animation (content team only) | $0.267 | 0 | 0 | 10 | poster + 4 s of Veo 3.1 Lite; learners are refused |
| TTS, one word (Munsit) | $0.0006 | 400 | ∞ | ∞ | curriculum words are cached on the row after the first synthesis |
| TTS, one line (Munsit) | $0.004 | 400 | ∞ | ∞ | listen-line-audio, listening cards |
| pronunciation attempt (Azure) | $0.001 | 60 | ∞ | ∞ | ~4 s of audio |
| set-phrase / shadow / chunk score (Munsit ASR) | $0.003 | 60 | ∞ | ∞ | ~5 s of audio; anonymous callers capped per IP |
| practice coach turn (ASR + Flash) | $0.008 | 40 | ∞ | ∞ | |
| monologue score (60 s) | $0.040 | 12 | ∞ | ∞ | ASR + Flash feedback |
| pronunciation-feedback | $0.003 | 60 | ∞ | ∞ | direct Flash |
| learner upload transcribe (1 min) | $0.035 | 10 | ∞ | ∞ | Munsit; Deepgram/Soniox legs are ~$0.005/min |
| **live voice, 1 minute (gpt-live-1)** | **$0.051** | 30 min/mo | 120 min/mo | 300 min/mo | voice layer + ~3 backend Luna turns per minute |
| live voice, 1 minute (gpt-realtime-2, rollback) | $0.052 | 30 | 120 | 300 | 30 s in + 30 s out per minute, context re-reads cached |

Three things in that table are worth reading twice.

- **A chat turn is up to five calls, not one.** The Sonnet reply is ~65% of
  the cost; the embedding, the Flash tool plan and the Flash memory update
  fire on every turn, and the HUMAIN native review whenever the reply
  contains Arabic, which for a tutor of Arabic is most turns.
- **A minute of voice costs a cent more than the per-minute list price**
  because the `live` engine bills its backend model separately. At the
  allowances on the pricing page, Standard's 120 minutes come to $6.17 and
  All-In's 300 to $15.41 — more than either plan nets.
- **A picture costs as much as four chat turns**, and today it is bought once
  per learner per session.

## 3. What a learner costs per month

Three personas, with the daily counts in §7. "Typical" is a subscriber who
opens the app on twenty days, chats eight times a day, reviews a quiz, saves
a few words, and uses their whole voice allowance.

| Persona | AI cost / month today | Top three lines |
|---|---:|---|
| Light — free, 12 active days | **$5.80** | quiz pictures $2.41; live voice $1.54; chat $0.66 |
| Typical — Standard, 20 active days | **$28.33** | quiz pictures $8.04; live voice $6.17; chat $2.94 |
| Heavy — All-In at the caps, 28 active days | **$164.47** | quiz pictures $46.90; flashcard images $18.76; chat $15.44 |

Against revenue:

| Plan | Price | Net of Stripe | Persona | AI cost today | Margin today | AI cost after fixes (§5) | Margin after |
|---|---:|---:|---|---:|---:|---:|---:|
| Free | $0 | $0 | Light | $5.80 | −$5.80 | $3.33 | −$3.33 |
| Standard monthly | $5.00 | $4.55 | Typical | $28.33 | −$23.78 | $15.56 | −$11.01 |
| Standard annual | $4.17/mo | $4.02 | Typical | $28.33 | −$24.31 | $15.56 | −$11.54 |
| All-In monthly | $15.00 | $14.26 | Heavy | $164.47 | −$150.21 | $91.44 | −$77.18 |
| All-In annual | $12.50/mo | $12.11 | Heavy | $164.47 | −$152.36 | $91.44 | −$79.33 |

Read the "Typical" row as a rate rather than a verdict: after the fixes a
typical active day costs about **$0.78**, so $4.55 buys about **six active
days**. A subscriber who opens the app twice a week is profitable; one who
opens it daily is not, at any plan. The Heavy row is what one person can do
with the caps as they stand — it is the exposure, not the expectation.

The full typical-day breakdown, so the levers are obvious:

| Action | per active day | per month |
|---|---:|---:|
| quiz picture (word-asset image) | 6 | $8.04 |
| live voice (minutes) | 6 | $6.17 |
| assistant-chat turn | 8 | $2.94 |
| how-do-i-say | 2 | $1.64 |
| flashcard / mnemonic image | 1 | $1.34 |
| word-enrichment (save a word) | 6 | $1.32 |
| daily-recap / video-debrief step | 3 | $0.98 |
| word dialogue (word-asset) | 4 | $0.91 |
| TTS, one line | 10 | $0.84 |
| daily story | 1 | $0.79 |
| grammar-drill | 1 | $0.65 |
| listening-quiz | 0.5 | $0.61 |
| TTS, one word | 40 | $0.45 |
| set-phrase / shadow score | 6 | $0.35 |
| translate-phrase | 4 | $0.33 |
| word / phrase jingle | 0.3 | $0.30 |
| pronunciation attempt | 10 | $0.29 |
| reading-passage | 0.3 | $0.23 |
| mistake-drill | 0.5 | $0.15 |

Two per-learner costs sit outside the personas because nobody clicks for
them. `pregenerate-daily` builds a daily story for every recently active
learner each night, opened or not — $0.039 × active learners × days, about
**$1.20 per active learner per month**, free users included (it stops at a
batch of 10–50 and a 100 s budget per run, so it is bounded by how often it
is scheduled, not by demand). And learner-error extraction (`extract-learner-errors`, Flash, ~$0.003)
fires after every voice-practice turn, and after a simulator turn in which
the tutor corrected the learner.

## 4. Where the caps do not hold

Worst-case daily spend by one learner, caps × unit cost. "uncapped" is a
subscriber on a feature with no `TierLimits`.

| Action | Free max/day | Standard max/day | All-In max/day |
|---|---:|---:|---:|
| listen audio (episode) | $3.50 | uncapped | uncapped |
| TTS, one line | $1.68 | uncapped | uncapped |
| live voice (monthly allowance ÷ 1 day) | $1.54 | $6.17 | $15.41 |
| quiz picture | $1.34 | $4.02 | $13.40 |
| flashcard / mnemonic image | $1.34 | $4.02 | $13.40 |
| listening-quiz | $0.91 | uncapped | uncapped |
| how-do-i-say | $0.82 | uncapped | uncapped |
| word / phrase jingle | $0.76 | $2.03 | $6.08 |
| analyze-meme | $0.76 | uncapped | uncapped |
| assistant-chat | $0.74 | uncapped | uncapped |
| word-enrichment | $0.66 | uncapped | uncapped |
| grammar-drill | $0.65 | uncapped | uncapped |
| reading-passage | $0.58 | uncapped | uncapped |
| hf-chat | $0.54 | uncapped | uncapped |
| free-chat | $0.49 | uncapped | uncapped |
| souq-news (4 articles) | $0.61 | uncapped | uncapped |
| monologue score | $0.48 | uncapped | uncapped |
| mistake-drill | $0.46 | $1.52 | $4.57 |
| generate-story | $0.46 | uncapped | uncapped |
| learner upload transcribe | $0.35 | uncapped | uncapped |

Only eleven functions carry a tier table today (`generate-celebration-song`,
`enrich-word-roots`, `generate-flashcard-image`, `generate-mnemonic-image`,
`generate-phrase-jingle`, `generate-word-jingle`, `generate-worksheet`,
`mistake-drill`, `monologue-prompts`, `writing-coach` and `word-asset`: 13
call sites). Four more are subscriber-only gates. The other 58 call sites
let any subscriber through uncapped. The August audit's "make caps tier-aware" was done for the features
that *looked* expensive (images, music) and not for the ones that are
expensive in aggregate (chat, council, ensembles, TTS, uploads). The
`ai-canary` trips at **$10/day** total (`CANARY_MAX_DAILY_USD`), which is
what currently stands between one enthusiastic All-In learner and the
OpenRouter key's limit. Three pipeline functions are reachable by any
signed-in learner with no cap at all (§6a).

## 5. What to change, in order

Each lever with its effect on the typical subscriber ($28.33 today).

1. **Apply the `word_assets` migration to the live project** (ask Lovable to
   run it, or `supabase db push`). Pictures then draw once per word per
   dialect and serve every learner; `useEnsureWordAsset` already stops asking
   for a word that is filed, and dialogues start being made at all. Effect:
   quiz pictures fall from $8.04 to well under $0.50 a month once the library
   is warm; dialogues go from refused to $0.011 each. **This is the whole
   difference between the "today" and "after" columns for pictures, and it
   needs no new code.**
2. **Fill the library once, on the batch tier.** `scripts/curriculum-pictures.ts
   --dry-run` prints the bill. The authored tracks hold **837** vocabulary
   words (Gulf 357, Yemeni 304, Egyptian 176; imported `.xlsx` lessons add to
   that); at $0.067 that is about **$56**, or **$28** if the picture route is
   given Google's batch endpoint
   ($0.034 per 1K image, half price, hours of latency — fine for a script,
   wrong for a learner waiting). The 62 curriculum clips are another $16.55
   (already costed in the README). A learner's own saved words still draw on
   demand, but keyed on the word so the second learner to save "تفاحة" pays
   nothing.
3. **Route `generate-flashcard-image` and `generate-mnemonic-image` through
   the store.** Both still call `generateImageDataUrl` directly and write the
   picture onto the learner's own row, so a word saved by a hundred learners
   is drawn a hundred times. They already build the prompt with
   `inkPicturePrompt`; the lookup is a `getAsset`/`putAsset` pair around it.
   Effect: −$1.34/month typical, and the $13.40/day All-In exposure becomes
   zero after the first learner.
4. **Reprice voice or shrink the allowance.** 120 minutes at $0.051 is
   $6.17, so the Standard plan loses money on voice alone if the allowance
   is used. Options, cheapest to implement first: Standard 60 min and All-In
   180 min (`VOICE_MONTHLY_SECONDS`, one constant — saves $3.08/month on the
   typical row); sell top-ups; or make voice All-In-only. Do not switch the
   engine to cut cost — `gpt-realtime-2` lands at about the same per-minute
   figure once its audio tokens are counted.
5. **Trim the chat turn's side-calls.** Four calls ride every turn. The
   memory update (`updateLearnerMemory`, Flash, 400 tokens) can run once per
   closed conversation instead of per turn — the README already describes
   the conversation as route-scoped with a clear end. The tool plan can skip
   the dialect prefix (`skipDemonstrations`: it emits no Arabic prose) and
   run on Flash-Lite, as the registry's own note recommends for calls whose
   answer is a label. Effect: a turn drops from $0.018 to about $0.015;
   −$0.50/month typical, more for heavy chatters.
6. **Put a tier table on the uncapped expensive endpoints.** Chat (40 free →
   e.g. 150 Standard / 400 All-In), `how-do-i-say` (20 → 60 / 150),
   `generate-listen-audio` and `listen-line-audio` (TTS is the largest
   uncapped unit), `listening-quiz`, `grammar-drill`, `analyze-meme`,
   `generate-story`, `munsit-transcribe`. Generous ceilings change nothing for
   the typical learner and cap the Heavy row at something a plan can carry.
   Mechanism exists (`TierLimits`); it is one argument per call site.
7. **Move English-output calls to Flash-Lite.** The registry's comment on
   `GEMINI_FAST` already names the candidates: CEFR rating, clip verification,
   trend triage — and, on the learner side, the tool plan, the memory
   summary, learner-error extraction and `screen-shared-content`. Flash-Lite
   is $0.25 / $1.50 against Flash's $0.75 / $3.75 (and will not inherit the
   2027 doubling, which is specific to the Flash tier). Keep every call that
   writes Arabic on Flash, for the reason the registry gives.
8. **Decide the repair pass on evidence.** The model assumes the Sonnet repair
   fires on 30% of calls; `llm_usage_logs` can say the real rate per
   `function_name`. If it is higher, tightening the detector's universal
   list (the demonstratives it flags in ordinary dialect prose) is worth more
   than any model swap, because a repair is a second full generation on the
   dearer model.
9. **Prepare for the Flash price step.** Every Flash line above doubles on
   2027-01-01 at current list. The candidates for the Arabic-writing calls
   are a newer Flash at the same promo price (Google lists 3.8 Flash at
   $0.75 / $3.75 through 2026 — same step afterwards), Flash-Lite where the
   output is not Arabic, or Sonnet with the cache for the calls that already
   spend most of their tokens on the cacheable prefix.

What is already right and should stay: the Sonnet prompt cache on the stable
dialect prefix (the identity, rulebook and demonstrations ride at $0.20 per
Mtok instead of $2); the draft_critic gate that runs the critic only on a
failed verdict rather than every request; Fanar in the occasional slots
rather than the standing one; Jais paused; the per-IP cap on the anonymous
endpoints; the canary's daily ceiling.

## 6. Content-side spend (per video, per batch job)

Nothing here is charged to a learner, but it is the same keys. The unit is a
**three-minute clip of about forty lines**, which is what the Discover feed
is made of. Token counts are assumptions as in §7; the call anatomy is read
from `process-approved-video` and `analyze-gulf-arabic`.

**ASR is a fan-out, not a ladder.** Every configured engine transcribes the
same audio and the merge reconciles them, so a clip pays for all of them:

| Engine | Billed | Per 3-minute clip |
|---|---|---:|
| ElevenLabs Scribe v2 (diarised, word timestamps) | $0.22/h | $0.011 |
| Soniox `stt-async-v5` with one-way English | $0.10/h + ~$0.16/h translation | $0.013 |
| Munsit `munsit-en-ar` — audio over 9 MB is chunked, up to three passes | 1,000 credits/min | $0.105 to $0.315 |
| Azure fast transcription | about $0.3–1/h (the USD page masks the rate) | $0.02–0.05 |
| Fanar STT | free; rationed 8 long-form + 18 short per day | $0 |
| Cohere transcribe pilot | only with `COHERE_API_KEY` | — |
| **ASR subtotal** | | **$0.15 to $0.39** |

**Analysis** (`analyze-gulf-arabic`, one call per attempt, up to two attempts):

| Step | Model(s) | Est. cost |
|---|---|---:|
| Merge of the transcripts | Qwen 235B (8k) in parallel with Fanar (8k, free) | $0.003 |
| Translation ensemble | Sonnet 16k + Flash 16k + HUMAIN M3 8k, reasoning "medium" | $0.079 |
| Fusha pass | Sonnet 16k | $0.033 |
| Vocabulary and grammar | Qwen 235B 8k | $0.002 |
| Fanar meta enrichment | Fanar 2k | $0 |
| Dialect check | M3, then Fanar | $0.002 |
| CAMeL dialect id (HF inference), Farasa diacritics (one request per line) | third-party, free tiers | ~$0 |
| Arbitration of disputed lines + Shaheen-MT tie-break | Fanar (16 MT calls/day) | $0 |
| Vocabulary enrichment | Sonnet 4k | $0.026 |
| Per-word gloss | Flash 4k | $0.010 |
| **Analysis subtotal** | | **~$0.16** |

**Finalize:** piece translations for long lines (Sonnet, one or two calls,
$0.014 each), a title when missing (Flash, no `max_tokens`), `rate-video-cefr`
(Flash, no `max_tokens`, $0.003) and the study guide (Sonnet 3k plus a
possible repair, $0.043). About **$0.06 to $0.08**.

**Per clip, all in: about $0.37 to $0.63.** A Re-transcribe repeats the
whole amount; a second analysis attempt adds ~$0.16. A hundred clips a month
is **$37 to $63**; three hundred is **$111 to $189**. The two levers are the
Munsit chunk passes (the only ASR leg that scales with length and retries)
and the translation ensemble's reasoning budget (Sonnet's thinking is billed
as output at $10 per Mtok; `TRANSLATION_REASONING=off` halves that line, at
the cost the registry comment describes — the literal readings that led to
it being switched back on).

**Other content jobs, per unit:**

| Job | Per unit | Notes |
|---|---:|---|
| `extract-visual-context` (16 frames, Flash) | $0.011 / video | also reachable from the learner Transcribe page |
| `reextract-on-screen-text`, video path | ~$0.04 / 3-min clip | the whole clip goes inline as video tokens |
| `import-authentic-story` | ~$0.08 / story | Flash 12k + dialect translation + validator + critic on "rewrite" |
| `translate-story-dialect` | ~$0.05 / story | |
| `generate-story-full-audio` (40 lines) | $0.17 Munsit, $0.19 ElevenLabs | one TTS call per line |
| `publish-verified-clips` | $0.006 / clip | Sonnet, 400 tokens |
| `verify-clip-candidate` | $0.002 / candidate | Flash, 512 tokens |
| `harvest-social-trends` | $0.003 / screened post | 60 by default, 150 max per run: $0.18 to $0.45 |
| `mine-dialect-corpus`, `draft-dialect-rules` | ~$0.11 / run | council: two drafts + Sonnet judge at 4k |
| `curriculum-chat` | $0.10 to $0.15 / generation, ~$0.03 / chat turn | up to 50 prior messages re-sent every turn; admins bypass its cap |
| `pregenerate-daily` | $0.039 / learner / night | batch 10 to 50, 100 s budget |
| `embed-content` | $0.003 / run of 500 texts | manual, no UI caller |
| `seed-set-phrases` | ~$0.005 / occasion | runs every occasion of a dialect unless told otherwise |
| YouTube Data API | quota, not dollars | `discover-trending-videos` burns 1,212 of the 10,000 daily units per run |
| Supadata captions, Firecrawl search | small per-call credits | captions free to ~100/month; Firecrawl is behind every `souq-news` request |

**Four things the map turned up that are not about price:**

- **HUMAIN M3 is asked up to three times per clip** — as a translation
  drafter, as the first rung of the dialect check, and as the standing
  validator leg wherever `enforceDialect` runs — on a key whose price is not
  public. Read Node's usage before anything else here.
- **Several calls send no `max_tokens`:** `rate-video-cefr`, the title call,
  `ai-resegment-transcript`, `classify-tutor-segments`, `seed-set-phrases`,
  `backfill-literal-translations` and `fallbackLineTranslate`. Each is a
  Flash call that can run to the provider's ceiling on a bad day.
- **A failed call can be paid twice:** the gateway re-sends a 400/401/403/404/408/5xx
  on OpenRouter, and the Brain's rescue ladder re-rolls the same model before
  walking the chain. Failure-only, and the right trade, but it is why a
  provider outage shows up in `llm_usage_logs` as a spend bump.
- **`backfill-literal-translations` re-glosses every 25-line chunk of a
  video** even when only a few lines lack a literal.

## 6a. Pipeline paths a learner can reach without a cap

Three content-pipeline functions are callable by any signed-in user and
carry no `enforceDailyCap`:

- `analyze-gulf-arabic` from the Transcribe and Learn-from-X pages: the
  whole analysis block above, $0.16 to $0.30 per call with the ASR legs the
  page supplies, **uncapped**.
- `classify-tutor-segments` from the tutor-upload page: one Flash call with no
  `max_tokens`, uncapped.
- `extract-visual-context` from the learner Transcribe page: $0.011 per
  call, uncapped.

Each wants the same one-line `enforceDailyCap` the other learner endpoints
have (the Transcribe page's `download-media` already has one at 60/day).

## 7. Assumptions, and how to replace them with measurements

The whole model is `scripts/ai-spend-model.py`: a price table, a token count
per call, a strategy multiplier, and a daily count per persona. Run it with
`python3 scripts/ai-spend-model.py` to reprint every table above; edit
`PERSONAS` or `PRICES` to re-ask the question. What it assumes:

- A stable dialect prefix of **1,200 tokens** (identity + Rulebook +
  demonstrations), cached on Sonnet via OpenRouter `cache_control`, paid in
  full on Flash (no explicit caching on the Google route). The live Rulebook's
  size is not visible from the repo; the fallback text is ~350 characters,
  the demonstrations ~350 characters per dialect.
- A learner profile block of ~700 tokens where a call carries one; a chat
  turn of ~4,700 input tokens (page context up to 8,000 characters, six
  retrieval chunks, 900 characters of memory, history) and 600 output.
- Reasoning: Flash's mandatory "low" is folded into the output estimate;
  Sonnet is floored at none, as `chatFetch` sends it.
- A repair pass on **30%** of Brain calls; a draft_critic critic on 30%
  (50% for stories, where the gate is stricter); a validator tie-break on
  15% of cross-checks.
- Munsit at **$0.035 per 1,000 credits** (between the Build and Starter
  plans; Basic is $0.05, Growth $0.025) — the plan the project is on decides
  this. TTS at 2 credits per character (standard voices; `faseeh-mini` is 1).
- HUMAIN M3 at a **placeholder** $0.50 / $1.50 per Mtok. It is in the
  standing validator leg, the chat native review and the transcript
  ensemble, so its real rate moves several lines; Node's console has it.
- Voice: three backend Luna turns per minute, most of the context cached.
- A shared asset (picture, dialogue, jingle) serving **40** learners over its
  life, which is what turns $0.067 into ~$0.002 in the lean tables.
- Azure's USD speech rates and the HUMAIN M3 rate are the two prices this
  document could not read from an official page; ElevenLabs Scribe ($0.22/h)
  and everything else in §1 were.
- Stripe at 2.9% + $0.30 per monthly charge.

Every one of these can be replaced by a query. `llm_usage_logs` carries
`function_name`, `llm_used`, `provider`, `prompt_tokens`,
`completion_tokens`, `cached_tokens`, `cost_usd` and `user_id` per upstream
call (Google and HUMAIN rows may have `cost_usd` null — price them from the
token columns at the table in §1). The three queries that settle this
document:

```sql
-- what a feature actually costs per call, and how often the repair fires
select function_name, llm_used, count(*) calls,
       avg(prompt_tokens) p, avg(completion_tokens) c, avg(cached_tokens) cached,
       sum(cost_usd) usd
from llm_usage_logs where created_at > now() - interval '30 days'
group by 1, 2 order by usd desc nulls last;

-- what a learner costs per month, by tier
select s.subscription_tier, count(distinct l.user_id) learners,
       sum(l.cost_usd) / count(distinct l.user_id) usd_per_learner
from llm_usage_logs l left join subscribers s on s.user_id = l.user_id
where l.created_at > now() - interval '30 days'
group by 1;

-- non-LLM legs (images, seconds of TTS/ASR) by unit
select function_name, unit_kind, sum(units) units, count(*) calls
from llm_usage_logs where unit_kind is not null
  and created_at > now() - interval '30 days'
group by 1, 2 order by units desc;
```

`voice_usage` gives minutes per learner per month directly, and
`usage_counters` gives the daily count per `(user, feature)` that the
personas guess at. Run the first query before changing a lineup: the
assumptions above are the part of this document most likely to be wrong,
and they are the cheapest part to check.

## 8. Before launch — revisit this

**Launch gate (owner's decision, 2026-10-10): do not open paid signups
until the four decisions below are made and the numbers in §3 have been
re-run against real `llm_usage_logs` rows.** With the setup as it stands a
Standard plan covers about three active days of typical use and an All-In
plan about ten; nothing here is profitable for a daily user, and most of
the gap is a handful of fixable things rather than the product itself.

### The four decisions

1. **Apply `word_assets` and fill the library** (§5 items 1–3). Not a
   decision so much as a prerequisite: without it every picture is drawn per
   learner per session and no cap table can make the quiz affordable.
2. **Voice allowance and price.** 120 min on Standard costs $6.17 against
   $4.55 net. Proposed: Free 10 min, Standard 30 min, All-In 120 min per
   month (`VOICE_MONTHLY_SECONDS`), plus top-ups if wanted. Change the
   pricing-page bullets in `useSubscription.ts` in the same commit — the
   Stripe-id test does not check them, but they must describe what the
   backend enforces.
3. **Which tutor each tier gets.** Proposed: Standard chats on Flash
   ($0.006 a turn), All-In on Sonnet ($0.014). `DEFAULT_CHAT` becomes a
   per-tier choice in `assistant-chat`. This is the one upgrade reason that
   costs nothing to build and is honest about the difference.
4. **The price points.** After every cut below, a daily Standard user still
   costs about $7.70 a month. Either Standard moves to $8–9, or it stays at
   $5 with the Standard caps below and the knowledge that the daily user is
   carried by the twice-a-week one. All-In at $15 works at typical use once
   the extras are capped; $19 carries the heavy user too. Decide from the
   second query in §7, which says how many subscribers are the daily kind.

### The lean configuration

Keep: the Discover library (content, amortised), the curriculum and quiz on
the shared store, pronunciation and shadow scoring, how-do-i-say, the tutor
chat, the daily story. Cut or share: phrase jingles and celebration songs
(personal, never shareable), story video and custom stories (make them a
library per dialect and level), listening episodes per learner (same),
souq news per request (one daily digest per dialect), meme analysis
(All-In only), learner-uploaded transcription (All-In only, on Soniox),
`hf-chat`, `culture-guide`, `dialect-compare`, `daily-challenge` and
`phrase-of-the-day` as separate per-learner generators. On the content
side, cut the speech fan-out from five engines to two (Soniox + Munsit) and
pregenerate daily stories for subscribers only.

Unit costs after the strategy changes (same assumptions as §7):

| Action | Today | Lean | Change |
|---|---:|---:|---|
| Tutor chat turn, Sonnet | $0.018 | $0.014 | memory update once per conversation; tool plan on Flash-Lite; native review off |
| Tutor chat turn, Flash | — | $0.006 | the Standard tutor |
| How do I say | $0.041 | $0.012 | council → draft_critic |
| Save a word | $0.011 | $0.004 | ensemble → solo Flash; repair on Flash |
| Grammar drill, listening quiz, souq quiz | $0.033 | $0.010 | ensemble → solo Flash |
| Reading passage, daily story | $0.038 / $0.039 | $0.020 / $0.021 | one validator leg (Gemini Pro) instead of two |
| Recap / debrief step | $0.016 | $0.0065 | Flash, no native review |
| Simulator turn | $0.016 | $0.005 | Gemini Pro → Flash; error extraction once per conversation |
| Quiz picture, flashcard image, dialogue, word jingle | $0.067 / $0.067 / $0.011 / $0.051 | ~$0.002 / $0.002 / $0.0003 / $0.001 | shared through the store, ~40 learners per asset |
| Learner transcribe, per 3-min video | $0.35–0.65 | $0.17 | Soniox for ASR; All-In only |

### Proposed caps

Per day unless marked. Every row is one `TierLimits` argument at the
endpoint's `enforceDailyCap` call; "pooled" means one counter key shared by
the practice generators.

| Feature | Free | Standard | All-In |
|---|---:|---:|---:|
| Tutor chat turns | 5 (Flash) | 20 (Flash) | 40 (Sonnet) |
| How do I say | 3 | 10 | 30 |
| Save a word (enrichment) | 10 | 25 | 60 |
| Quiz pictures / dialogues (shared) | 20 / 30 | 60 / 100 | 200 / 300 |
| Flashcard images (through the store) | 0 | 10 | 30 |
| TTS words / lines | 100 / 10 | 250 / 30 | 600 / 100 |
| Pronunciation / shadow attempts | 30 / 20 | 60 / 40 | 200 / 120 |
| Practice generators, pooled (drills, passages, quizzes) | 1 | 3 | 8 |
| Daily story | 1, on demand | 1 | 1 |
| Recap / debrief steps | 0 | 4 | 12 |
| Simulator turns | 0 | 15 | 40 |
| Translate phrase or text | 10 | 25 | 60 |
| Word jingles (shared) | 0 | 3 | 10 |
| Writing coach / monologue / worksheet | 2 / 1 / 0 | 6 / 3 / 2 | 20 / 8 / 5 |
| Meme analysis / custom story / transcribe a video / listen episode | 0 | 0 | 5 / 3 / 3 / 1 |
| `analyze-gulf-arabic`, `classify-tutor-segments`, `extract-visual-context` | 0 | 0 | 3 |
| Live voice, per month | 10 min | 30 min | 120 min |

### What that produces

| | Typical active day | Voice per month | Break-even active days |
|---|---:|---:|---:|
| Standard, Flash tutor, $4.55 net | $0.29 | $1.54 | about 10 |
| All-In, Sonnet tutor, $14.26 net | $0.35 | $6.17 | about 23 |
| All-In on a heavy day (30 Sonnet turns, 40 TTS lines) | $0.95 | $6.17 | about 8 |

Today those break-evens are about three days and ten days. The caps also bound
abuse: a Standard account that hits every cap every day costs about $46 a
month instead of unbounded; an All-In one about $189, almost all of it story
video, transcription and Sonnet chat, which is why those sit on All-In
only. The arithmetic is the `LEAN` and `CAPS` blocks at the end of
`scripts/ai-spend-model.py`; edit a unit cost or a cap and re-run it.
