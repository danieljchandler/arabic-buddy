# humain-m3 / ALLaM — does the new Arabic frontier model belong in this pipeline?

**Date:** 2026-09-05 · **Status:** research, no code changed · **Verdict:** don't integrate
yet; run the free experiment first (§7).

This picks up where [`ai-pipeline-audit-2026-08.md`](./ai-pipeline-audit-2026-08.md) left
off. That audit proposed ALLaM for three roles and then dropped it, for a reason that is
now partly obsolete. Two things have changed since; neither is quite what it looks like
from the headlines.

---

## 1. What actually shipped, and what it is called

Three separate things are easy to conflate, and the press coverage conflates them:

| Thing | What it actually is | Date |
|---|---|---|
| **HUMAIN** | Saudi PIF-backed AI company. Not "Humane" (that was the AI Pin company, sold to HP in 2025) | — |
| **ALLaM** (علّام) | SDAIA's Arabic-first model family, operated by HUMAIN. `ALLaM-2-7b`, `ALLaM-34B`. **This is "Alam."** | ongoing |
| **humain-m3** | A *new, different* model: 428B MoE commissioned by HUMAIN **from MiniMax**, built on the MiniMax-M3 lineage. Not an ALLaM model. | **2026-09-03** |

So there are two partnerships, not one:

- **HUMAIN × MiniMax** → produced `humain-m3`, released in research preview two days ago.
- **HUMAIN × Microsoft** (announced Aug 2026) → puts the **ALLaM** family into Microsoft
  Foundry and M365 Copilot.

The model that "just came out" is humain-m3. The partnership that matters most *to this
repo* is the Microsoft one — for reasons in §5.

### humain-m3 specifications

- 428B total parameters, **23B activated per token** (MoE)
- Natively multimodal — text, image and video jointly trained from scratch
- Three thinking modes (always-on / adaptive / off), tool use, computer vision
- Trained on **>1T tokens of Arabic-native content** on top of the MiniMax-M3 base
- OpenAI-compatible API endpoint on **HUMAIN Node** (`node.humain.com`), plus a no-code
  playground
- Two preview tiers: limited-preview (Saudi alignment guardrails) and research-preview
  (full capabilities)
- Open weights planned "next month" under the **MiniMax Community License**
- **No published pricing, no published rate limits, no published context window** for the
  HUMAIN build. The MiniMax-M3 base it derives from is 1M context / 262k max output.

---

## 2. The benchmark scores — and why they are the wrong axis

HUMAIN's evaluation, averaged across seven benchmarks:

| Model | Average |
|---|---|
| **humain-m3** | **89.37%** |
| Opus 5 | 87.34% |
| GPT-5.6 SOL | 87.30% |
| MiniMax M3 (reference checkpoint) | 80.34% |

Per benchmark:

| Benchmark | humain-m3 | What it measures |
|---|---|---|
| MadinahQA | 95.44% | Arabic **grammar and language proficiency** — i.e. فصحى |
| AraTrust | 97.53% | Truthfulness |
| ALRAGE | 94.63% | Retrieval-augmented generation |
| Translated MMLU | 93.20% | General knowledge, translated |
| ArabicMMLU | 90.70% | **MSA** school/professional exams |
| AlGhafa | 86.45% | Multiple-choice comprehension, from public NLP datasets |
| Arabic EXAMS | 67.67% | Academic exams |

**All seven are MSA, knowledge or grammar benchmarks. Not one measures dialect
production.** ArabicMMLU is explicitly an MMLU-like framework built for MSA from school
exams; MadinahQA tests Arabic grammar. OALL v2 — the leaderboard these come from —
deliberately moved to native benchmarks (ArabicMMLU, ALRAGE, AraTrust, MadinahQA) as a
*quality* improvement, and every one of them is MSA-register.

This matters more here than it would anywhere else. Hakiya's single quality metric is the
inverse of these: `msaLeakDetector.ts` flags a generation *because* it reads as MSA.
`الذي`, `سوف`, `ليس`, `الآن`, `بينما` are the tokens the golden set marks as failures —
and fluent, correct use of exactly those tokens is what MadinahQA's 95.44% is rewarding.

A model can top all seven of these and still be the wrong model for this app. **The
89.37% is not evidence about anything Hakiya ships.**

---

## 3. What the dialect evidence actually says

There is no dialect benchmark for humain-m3. HUMAIN says only that the preview period is
for evaluating "capabilities, safety, and alignment across Arabic dialects" — i.e. they
are asking preview users to find out, not reporting a result.

For **ALLaM** there is real published evidence, and it is not encouraging.

The UI-level evaluation of ALLaM-34B through HUMAIN Chat (arXiv:2508.17378 — 23 prompts ×
5 runs, scored by three frontier judges) breaks down as:

| Category | Score /5 |
|---|---|
| Code-switching | 4.92 |
| Creative generation | 4.92 |
| MSA | 4.74 |
| Reasoning | 4.64 |
| Safety | 4.54 |
| **Dialect fidelity** | **4.21** |

**Dialect is its weakest category.** And the qualitative failures are precisely Hakiya's
failure mode, not generic weakness:

- Egyptian prompt (`عامل إيه يا صاحبي`, a casual greeting) → the model "often generated
  assistant-style **MSA** self-introductions" instead of answering in Egyptian.
- Hijazi prompt about news in Jeddah → "lengthy **MSA** news bulletins with topical
  sections."
- Najdi prompt about Riyadh weather → accurate facts, in a structured **English** summary.

That is the AL-QASIDA reluctance pattern (arXiv:2412.04193) that this codebase already
builds its whole prompt strategy around — and it is present in the Arabic-native model, not
absent from it.

Corroborating: the Saudi-Dialect-ALLaM LoRA work (arXiv:2508.13525) exists *because*
untuned ALLaM reverts to MSA; its tuned variant gets Saudi-aligned generation to 84.2% with
MSA leakage held to 6.3%. You need a fine-tune to get there. The base model does not do it.

The general market picture agrees: of the Arabic-native models, only Falcon-H1-Arabic and
Fanar-2 claim explicit dialect training, and the standing advice for production dialect work
is to put example dialect phrases in the system prompt — which is what
`getDialectDemonstrations()` already does.

**Being Arabic-native is not the same as being dialect-native.** These models are trained
to be excellent at the register Hakiya refuses to teach.

---

## 4. What this repo already decided about ALLaM

This is not a new question here. The August audit (§3, `ai-pipeline-audit-2026-08.md`)
proposed ALLaM for three slots — `dialectValidator`, the aiBrain MSA-leak repair pass, and
vocab enrichment — on the reasoning that a small Arabic-native model is the right tool for
per-item, short-form Arabic judgement.

**It was dropped on 2026-08-05, and the stated reason was purely one of access:** ALLaM
left Groq, and DeepInfra, Fireworks, Together and OpenRouter were all checked directly —
none hosted it pay-per-token. `mistralai/mistral-saba` took the role instead, because it
reached the same architectural slot on a key the app already held.

That reason is the one thing the Microsoft partnership actually fixes. It is worth being
precise about what was and was not settled:

- **Settled, and still true:** Saba occupies the Arabic-native second-opinion slot in
  `validateDialectCrossChecked()`, with Fanar as the disagreement-gated tiebreak. That
  design is sound and nothing here argues against it.
- **Unsettled:** whether ALLaM would have been *better* than Saba at it. That was never
  measured — it was dropped for hosting, not for quality.

---

## 5. Access and routing — the integration cost, concretely

`aiGateway.ts` routes on vendor prefix, and `canFallBack()` decides whether OpenRouter can
rescue a vendor. Where each candidate lands:

| Model | Reachable today? | Routing work | OpenRouter safety net? |
|---|---|---|---|
| `minimax/minimax-m3` (base) | **Yes — right now** | **None.** Unprefixed vendors fall through to `openrouter` in `vendorForModel()` | n/a — it *is* OpenRouter |
| `humain-m3` | No — HUMAIN Node preview only | New `Provider`, new URL, new key, new `KEY_ENV`/`CHAT_URLS` entries — the Fanar shape | **No.** Not on OpenRouter |
| `humain-m3` open weights | Not yet — "next month" | Depends who hosts it | Likely, once a host lists it |
| ALLaM via Microsoft Foundry | Foundry deployment required | Azure endpoint + deployment-name indirection; not a prefix strip | **No** |

Two things follow.

**humain-m3 would be a second Fanar.** `canFallBack()` exists as a function precisely
because Fanar is a sovereign model on its own endpoint with no OpenRouter twin, so a
failure there is a real failure rather than a retry. humain-m3 has exactly that shape
today. Adding it means adding a provider that cannot be rescued — acceptable for an
optional validator leg (which is how `validateDialect` already degrades), not acceptable
anywhere on a learner-facing generation path.

**Foundry is a bigger lift than it sounds.** Azure addresses models by *deployment name*,
not model id, which is the one thing `upstreamModelId()`'s prefix-strip design doesn't
model. It would need a real alias map, not a regex branch.

### Cost, where published

| Model | Input / output per Mtok | Source |
|---|---|---|
| MiniMax M3 (OpenRouter) | $0.23 / $0.96 (cache read $0.05) | OpenRouter |
| Mistral Saba | $0.20 / $0.60 | current pipeline |
| Claude Sonnet 5 | $2 / $10 | registry |
| **humain-m3** | **unpublished** | — |

A preview model with no published price and no published rate limit cannot be budgeted,
and `usageCap.ts` / `enforceDailyCap` are built on the assumption that spend is knowable.

---

## 6. Where it could fit, if the evidence supported it

Ranked by fit. Note that none of these is a translation or English-prose slot — the August
audit's finding that Arabic-centric models buy nothing on AR→EN still holds, and humain-m3's
benchmarks say nothing about English.

1. **Third leg in `validateDialectCrossChecked()`** — the natural entry point. The
   validator is optional by design (`ok: false` on provider failure), so a preview-tier
   model with unknown uptime degrades the gate instead of breaking generation. This is the
   same slot the August audit picked for ALLaM, and the same argument still applies.
2. **MSA-leak repair in `aiBrain.ts`** — short snippets, Arabic-native rewrite,
   latency-sensitive. But a repair pass runs *on the learner's path*, so no-fallback
   routing is a real risk here in a way it isn't at (1).
3. **`REASONING` lineup third leg**, replacing `GEMINI_PRO` — humain-m3 beats Opus 5 and
   GPT-5.6 SOL on the Arabic knowledge benchmarks, which is genuinely the right axis for
   *council* verification of factual/cultural claims. Worth revisiting after open weights.
4. **Multimodal transcript review** — humain-m3 is natively video-capable with long-video
   understanding. Nothing in the current `discover_videos` pipeline uses a multimodal model
   on the video itself; ASR is five audio engines and the analysis is text-only. This is
   the most *interesting* fit and the least explored, but it's a new capability rather than
   a swap, and it is out of scope for a model-registry decision.

**Not a fit:** `TRANSLATION` (target language is English), `UTILITY` (no price, and the
whole point of that lineup is a known cheap unit cost), `CONTENT` drafting (needs English
pedagogical prose and structured-output reliability).

---

## 7. What to actually do

### Now — the free experiment (no code, no new key, ~30 min)

`scripts/eval-dialect-live.ts` already routes any model through the exact prompt the Brain
builds and scores it with the same leak detector CI pins. `minimax/minimax-m3` — the base
checkpoint humain-m3 is built on — is on OpenRouter today and needs **zero** routing
changes:

```sh
OPENROUTER_API_KEY=... deno run --allow-env --allow-read --allow-net \
  scripts/eval-dialect-live.ts --model google/gemini-3.7-flash \
                              --compare minimax/minimax-m3
```

This is a lower bound, not a measurement of humain-m3: the Arabic post-training is worth
~9 points on HUMAIN's own MSA benchmarks (80.34% → 89.37%), and dialect could move in
either direction from there. But it is a cheap, real read on whether the *lineage* holds
dialect under this prompt, and it costs one OpenRouter call per golden row.

Also worth running, since it is the same command:

```sh
# does the Arabic post-training show up as dialect, or only as MSA fluency?
... --model mistralai/mistral-saba --compare minimax/minimax-m3
```

### Blocking issue: the golden set is too small to adjudicate this

30 rows, 10 per dialect. At that size **one reply is ten percentage points** on a
per-dialect number — the script's own comment says as much, which is why it reports deltas
in points rather than ratios. That is fine for catching a catastrophic regression on a
registry bump. It is not enough to decide a model swap, and it is nowhere near enough to
resolve a difference between two models that are both mostly-clean.

**Expand the golden set to ~50 rows per dialect before any of this is decidable.** That is
the highest-value work in this document, and it is worth doing whether or not humain-m3
ever ships — every future registry bump is measured against it.

### Ask HUMAIN, while you have preview access

The preview period is explicitly for capability and dialect-alignment feedback, so these
are in-scope questions, and none of them are answerable from the outside:

1. Context window and max output for the HUMAIN build (the MiniMax-M3 base is 1M — is that
   preserved?).
2. Pricing and rate limits at GA.
3. **Dialect breakdown** — Gulf/Khaliji, Egyptian, Yemeni specifically. Is there any
   internal dialect-production eval, or only the seven OALL-style benchmarks?
4. Does the limited-preview tier's "Saudi alignment guardrails" alter register — i.e. does
   it push output toward MSA? For this app that would be disqualifying, and it is the sort
   of thing that would not show up in any of the seven scores.
5. Forced tool calling / structured output — `aiBrain.callModel()` sets `tools` +
   `tool_choice: {type:'function'}` and treats a missing tool call as a recoverable
   failure. A model without it burns the full retry ladder on every structured task. This
   was flagged as *the* real integration cost for ALLaM in August and it is unchanged here.

### Wait for

- **Open weights** (targeted October 2026, MiniMax Community License). That is when a
  pay-per-token host is likely to list it, which is the difference between a Fanar-shaped
  no-fallback provider and a one-line registry addition.
- **ALLaM on Foundry, priced.** If ALLaM becomes reachable pay-per-token, the August
  proposal's *access* objection is gone — but §3 says its dialect fidelity is its weakest
  axis, so it should re-enter as a candidate to be measured against Saba, not as a
  foregone upgrade.

---

## 8. Bottom line

**The model is real, the benchmarks are real, and they measure the wrong thing for this
app.** humain-m3 leads three frontier models on Arabic knowledge and grammar. Hakiya does
not ship Arabic knowledge or grammar; it ships spoken dialect, and it measures itself by how
*little* MSA reaches a learner. The one Arabic-native model in this family with published
dialect data scores lowest there, and fails in the exact way — MSA self-introductions in
place of Egyptian greetings — that `msaLeakDetector.ts` exists to catch.

Nothing here justifies a registry change today. What it justifies is:

1. Expand the golden set (needed regardless, blocks everything else).
2. Run the free `minimax/minimax-m3` comparison — zero integration cost, available now.
3. Put the five questions above to HUMAIN while the preview access is live.
4. Revisit at open weights, as a `REASONING`-leg or validator-leg candidate, measured on
   the golden set — never adopted on the strength of an OALL average.

The pipeline already has the instrument to settle this properly. The honest answer is that
the instrument needs a bigger dial before it can read the difference.

---

## Sources

- [HUMAIN unveils humain-m3 (PR Newswire, 2026-09-03)](http://www.prnewswire.com/news-releases/humain-unveils-humain-m3-a-frontier-arabic-language-model-developed-by-minimax-in-research-preview-on-humain-node-302869158.html)
- [PIF-Backed HUMAIN Launches humain-m3 at LEAP Riyadh (Unite.AI)](https://www.unite.ai/pif-backed-humain-launches-humain-m3-arabic-model-at-leap-riyadh/)
- [UI-Level Evaluation of ALLaM 34B (arXiv:2508.17378)](https://arxiv.org/abs/2508.17378)
- [Saudi-Dialect-ALLaM: LoRA Fine-Tuning for Dialectal Arabic Generation (arXiv:2508.13525)](https://arxiv.org/pdf/2508.13525)
- [DialectalArabicMMLU (arXiv:2510.27543)](https://arxiv.org/abs/2510.27543)
- [ALLaM: Large Language Models for Arabic and English (arXiv:2407.15390)](https://arxiv.org/abs/2407.15390)
- [Microsoft and HUMAIN strategic collaboration (PR Newswire, Aug 2026)](http://www.prnewswire.com/news-releases/microsoft-and-humain-announce-long-term-strategic-collaboration-to-enable-ai-transformation-in-saudi-arabia-and-beyond-302860378.html)
- [Microsoft puts Saudi Arabic-language AI model on global platform (AGBI)](https://www.agbi.com/ai/2026/08/microsoft-puts-saudi-arabic-language-ai-model-on-global-platform/)
- [MiniMax M3 — API pricing (OpenRouter)](https://openrouter.ai/minimax/minimax-m3)
- [Best Arabic LLMs 2026: Jais, Falcon, ALLaM, Fanar (OALL)](https://www.promptquorum.com/local-llms/best-arabic-local-llms-2026)
- [AlGhafa Evaluation Benchmark (ACL Anthology)](https://aclanthology.org/2023.arabicnlp-1.21/)
