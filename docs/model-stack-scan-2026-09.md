# Model stack scan — September 2026

**Date:** 2026-09-05 · **Status:** research, no code changed · **Companion to**
[`humain-m3-allam-evaluation-2026-09.md`](./humain-m3-allam-evaluation-2026-09.md)

That document answered one question (does the new Arabic frontier model belong here?).
This one asks the general version: given everything shipped in the last few months, is
anything worth adding? The stack inventory below is read off the code as it stands today —
[`ai-pipeline-audit-2026-08.md`](./ai-pipeline-audit-2026-08.md)'s Part 1 table is now
stale in about a dozen places, because most of its recommendations shipped.

**Short answer:** one clear upgrade (Gemini 3.8 Flash), two cheap version checks, and a
longer list of things that look attractive and are not. Nothing here should ship before the
golden set grows — see §6.

---

## 1. The stack as it actually is

### Text models — `_shared/modelRegistry.ts`

| Slot | Model | Routed via | Where it's used |
|---|---|---|---|
| `CLAUDE` / `CLAUDE_CHAT` | `anthropic/claude-sonnet-5` | OpenRouter | TRANSLATION leg, CONTENT judge, `DEFAULT_CHAT` |
| `GEMINI_FLASH` / `GEMINI_FAST` | `google/gemini-3.7-flash` | Google | TRANSLATION leg, CONTENT drafter, **all of UTILITY** |
| `GEMINI_PRO` | `google/gemini-3.1-pro-preview` | Google | REASONING 3rd leg, `dialectValidator` judge |
| `QWEN` | `qwen/qwen3.8-max` | OpenRouter | 3rd-leg verifier (weight 0.6) |
| `SABA` | `mistralai/mistral-saba` | OpenRouter | Arabic-native leg in `validateDialectCrossChecked()` |
| `GPT_MINI` | `openai/gpt-5.6-luna` | OpenAI | 2nd drafter in `generate-story` |
| `FANAR` | `Fanar-C-2-27B` | QCRI direct (no fallback) | Merge fallback, meta enrichment, validator tiebreak |

### Everything else

| Layer | What's running |
|---|---|
| **ASR fan-out** (5–6 legs, parallel) | Munsit `munsit-en-ar` (fallback `munsit`) · Soniox `stt-async-v5` · ElevenLabs `scribe_v2` · Cohere `cohere-transcribe-arabic-07-2026` *(env-gated pilot)* · Fanar `Fanar-Aura-STT-1` / `-LF-1` · Azure |
| **TTS** | Munsit **Faseeh** for every dialect (`_shared/ttsVoiceRouting.ts`), ElevenLabs `eleven_multilingual_v2` as the Egyptian rung, Azure Neural as the emergency floor |
| **Live voice** | OpenAI `gpt-realtime-2` |
| **Embeddings** | OpenAI `text-embedding-3-small`, 1536 dims, `vector(1536)` in two migrations |
| **Dialect ID** | CAMeL-Lab BERT via HF Inference |
| **Arabic NLP** | Farasa (QCRI) — diacritization, segmentation, POS |
| **Images** | `google/gemini-3.1-flash-image`, `openai/gpt-image-2` |

---

## 2. Worth doing: Gemini 3.8 Flash

Google shipped **Gemini 3.8 Flash on 2026-09-02** — its fourth Flash release in under four
months. It is on OpenRouter and Google's own API.

| | 3.7 Flash (pinned) | 3.8 Flash |
|---|---|---|
| Price | $0.75 / $3.75 per Mtok | **$0.75 / $3.75 — identical** |
| Terminal-Bench 2.1 | 81.6% | 90.8% |
| DeepSWE v1.1 | 65.3% | 73.7% |
| Humanity's Last Exam | 45.7% | 45.4% (flat) |

Google reports it beating 3.7 Flash on every benchmark it published, at the same price.

**Why this slot matters more than the number suggests.** `GEMINI_FLASH` and `GEMINI_FAST`
are the same id, and between them they carry a TRANSLATION ensemble leg, the CONTENT
drafter, and the whole UTILITY lineup — which the registry's own comment identifies as
"the one most of the app's learner-facing Arabic is generated with: set phrases,
situational phrases, souq retellings, jingle lyrics, mnemonics, reading Q&A and the daily
challenge." It is the highest-volume dialect path in the app. A free quality bump here is
worth more than anywhere else in the registry.

**The catch, and it is the same one as PR #341.** Every published gain is coding, tool use
and long-horizon agentic work. None of it is dialect, and HLE went slightly *down*. A model
that got better at Terminal-Bench has told you nothing about whether it holds Gulf
morphology under the Brain's prompt. Newer is not automatically better on this axis —
more aligned models have historically been *more* MSA-reluctant, not less.

So: **one-line registry change, gated on the eval.**

```sh
GEMINI_API_KEY=... deno run --allow-env --allow-read --allow-net \
  scripts/eval-dialect-live.ts --model google/gemini-3.7-flash \
                              --compare google/gemini-3.8-flash
```

This is exactly the check `--compare` was built for — the script's own header calls it "the
check to run before a registry bump ships." Ship the bump if leak rate holds or improves;
don't if it regresses, whatever Terminal-Bench says.

**Budget note:** both 3.7 and 3.8 Flash double in price on **1 January 2027**. That is not
a reason to delay the swap (identical prices either way), but it is a real line-item change
for `usageCap.ts` planning on the app's highest-volume path.

---

## 3. Worth checking: two version pins

**`gpt-realtime-2` → `gpt-realtime-2.1`.** `realtime-session-token/index.ts:38` pins
`gpt-realtime-2`; OpenAI's current Realtime lineup is `gpt-realtime-2.1` (plus
`gpt-realtime-mini`). A point release on a pinned model is worth confirming and bumping —
this is the learner-facing voice tutor, and it is the one place in the stack where the model
id is hardcoded outside the registry.

**Is the Cohere ASR leg actually on?** `process-approved-video/index.ts:1013` runs Cohere
Transcribe Arabic **only when `COHERE_API_KEY` is set**, and returns `{ text: null }`
silently otherwise. Cohere positions it as the most accurate open-source Arabic STT to
date, built specifically for dialect variation and Arabic–English code-switching, and
claims it beats Whisper and OmniASR across dialects — which is precisely this pipeline's
hardest input. Worth confirming the key is set in production rather than assuming the leg
is contributing. If it isn't, that's a free engine.

---

## 4. Looked at and rejected

**Claude Fable 5.1** (2026-09-01, `anthropic/claude-fable-5.1`, 1M ctx) and **GPT-6 Astra**
(2026-09-03, `gpt-6-astra`, 1.05M ctx) are both **$10 / $50 per Mtok** — five times Sonnet
5's $2/$10. Both are frontier agentic/coding models; their headline gains are long code
refactors, front-end generation and long-running agent workflows. This pipeline does not do
any of that. It does many small Arabic generations, where 5× the price buys nothing it
needs. Fable 5.1 does drop cache reads to $0.25/Mtok, which would matter for a pipeline
dominated by a large stable prefix — but not enough to close a 5× gap.

**`gpt-realtime-mini`** ($10/$20 vs the flagship's $32/$64) would cut voice-tutor cost by
about two-thirds. Rejected on the repo's own stated rule: the `GEMINI_FAST` comment argues
at length that buying a cheaper tier on a path that *produces dialect* is the wrong side of
the trade, because dialect reluctance worsens as models get smaller and more aligned. The
live voice tutor is the most dialect-exposed surface in the product. Same logic, same
answer.

**Gemini Pro — no change.** `google/gemini-3.1-pro-preview` is still the newest Pro
available; Gemini 3.5 Pro was announced at I/O in May 2026 and has not shipped. It also
sits joint-first on Artificial Analysis's Arabic index at 93 (though see §6 — that index is
Global-MMLU-Lite, i.e. reasoning *in* Arabic, not dialect production). The pin is correct
and current; the `-preview` suffix is a known, documented risk the validator already
degrades around.

**Munsit Yemeni voice — the marketing is ahead of the catalogue.** Munsit now advertises
25+ dialects "including Yemeni." Their actual voices documentation lists Fusha, Emirati,
Najdi, Hijazi, Kuwaiti and British — **no Yemeni voice**. `ttsVoiceRoutingCore.ts:45-49`
already says exactly this, already puts Yemeni's own tags (`yemeni`, `sanaani`, `taizzi`,
`adeni`) first in the lookup, and already picks one up with no code change if Munsit ever
ships one. Nothing to do. Flagged only because the vendor's claim invites a change that
would be a regression — and `docs/tts-voice-routing.md` records that this exact fix was
already made once, in the wrong direction, and reverted.

**Embeddings — flagged, not recommended.** `text-embedding-3-small` is a 2024-era model,
and there is now a dialect-aware Arabic embedding benchmark (**ArabicMTEB**, 94 datasets
across 8 tasks) plus Arabic-centric models (**Swan-Large**, 62.45 avg, ahead of
Multilingual-E5-large at 61.65). Cohere `embed-v4.0` is a hosted multilingual option and
the app *already holds a Cohere key*. Against that: `vector(1536)` is baked into two
migrations and the match RPCs, and switching invalidates every stored vector — a real
migration, not a config change. Swan is a research model with no hosted API, which
collides with the stack's "nothing is self-hosted" property. Only worth it on a measured
Arabic retrieval gain, which nobody has produced yet. Not now.

---

## 5. Watch list

| What | When | Why it matters here |
|---|---|---|
| **Fanar 3.0** | Dec 2026 (QCRI) | Current pin is `Fanar-C-2-27B` (Fanar 2.0, Mar 2026). Fanar is the validator tiebreak and the merge fallback |
| **humain-m3 open weights** | Oct 2026 | Turns a no-fallback sovereign endpoint into a possible one-line registry addition — see PR #341 |
| **Gemini 3.5 Pro** | announced May 2026, unshipped | Would replace the `-preview` pin on `GEMINI_PRO` |
| **Jais 2 (70B), Falcon-H1-Arabic** | shipped | Both lead OALL, neither is on OpenRouter — local deploy only, which the stack deliberately doesn't do |

---

## 6. The process point, restated

Every headline number in this document — Terminal-Bench, DeepSWE, Global-MMLU-Lite Arabic,
OALL — measures reasoning, coding, or MSA. None measures whether a model produces spoken
Gulf, Egyptian or Yemeni without leaking فصحى. That is the same trap PR #341 documents for
humain-m3, and it applies just as much to a Gemini point release as to an Arabic-specialist
frontier model.

`scripts/eval-dialect-live.ts` is the only instrument in the repo pointed at the right axis,
and it reads against **30 golden rows, 10 per dialect** — one reply is ten percentage points.
That resolution can catch a catastrophic regression. It cannot tell you whether 3.8 Flash is
half a point better or worse than 3.7 on Gulf.

**Expanding the golden set to ~50 rows per dialect is the prerequisite for acting on
anything in this document**, the Gemini bump included. It was already the top recommendation
in the humain-m3 assessment; it is the same recommendation, reached from a second direction.

---

## Sources

- [Google has released Gemini 3.8 Flash (Artificial Analysis)](https://artificialanalysis.ai/articles/gemini-3-8-flash)
- [Gemini 3.8 Flash — API pricing & benchmarks (OpenRouter)](https://openrouter.ai/google/gemini-3.8-flash)
- [Gemini 3.8 Flash review: benchmarks, pricing (eesel)](https://www.eesel.ai/blog/gemini-3-8-flash)
- [Claude Fable 5.1 — API pricing (OpenRouter)](https://openrouter.ai/anthropic/claude-fable-5.1)
- [GPT-6 Astra: benchmarks, pricing and API](https://computingforgeeks.com/gpt-6-astra-released-features-benchmarks/)
- [Introducing gpt-realtime and Realtime API updates (OpenAI)](https://openai.com/index/introducing-gpt-realtime/)
- [Cohere Transcribe Arabic](https://cohere.com/blog/transcribe-arabic)
- [Munsit TTS voices documentation](https://docs.munsit.com/text-to-speech/voices)
- [Arabic Language — Multilingual LLM benchmark (Artificial Analysis)](https://artificialanalysis.ai/models/multilingual/arabic)
- [Swan and ArabicMTEB (arXiv:2411.01192)](https://arxiv.org/abs/2411.01192)
- [Qatar announces Fanar 2.0 Arabic AI model](https://www.middleeastainews.com/p/qatar-announces-fanar-20-arabic-ai)
- [Best Arabic LLMs 2026: Jais, Falcon, ALLaM, Fanar (OALL)](https://www.promptquorum.com/local-llms/best-arabic-local-llms-2026)
