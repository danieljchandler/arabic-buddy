// =============================================================================
// CENTRAL MODEL REGISTRY — single source of truth for all AI model selection.
// =============================================================================
//
// RULE: Do NOT hardcode model IDs in feature code. If a model breaks, fix the
// root cause (credits, routing, prompt) rather than silently swapping models
// in individual edge functions. Only swap models HERE, in one place.
//
// Two named lineups power everything translation- or content-related:
//   - TRANSLATION: Claude Sonnet 5 + Gemini 3.7 Flash, ensemble.
//   - CONTENT:    Claude Sonnet 5 + Gemini 3.7 Flash, draft_critic.
//
// This file names the model; `aiGateway.ts` decides whose API serves it —
// Gemini via Google (GEMINI_API_KEY), GPT via OpenAI (OPENAI_API_KEY), and
// everything else — plus anything whose own key is missing — via OpenRouter
// (OPENROUTER_API_KEY). Keep the ids here in OpenRouter's `vendor/model` form:
// that is the one namespace all three providers can be addressed from, and
// aiGateway strips the prefix for the vendors that don't want it.
//
// Live voice (realtime-session-token) and ASR/TTS models are NOT governed by
// this registry — they have their own provider-specific configs. Image models
// are, as of the move off Lovable: see IMAGE_MODEL_IDS below.
// =============================================================================

// ---- Canonical model IDs ----------------------------------------------------
// Bump these when upgrading; everything downstream picks it up automatically.
export const MODEL_IDS = {
  // One Sonnet for everything, not two. Sonnet 5 superseded Sonnet 4.5 and is
  // *cheaper* than the model it replaces ($2/$10 vs $3/$15 per Mtok), so the
  // old split — 4.5 for the pipeline, 5 for chat — cost more and reasoned worse.
  CLAUDE: 'anthropic/claude-sonnet-5',
  CLAUDE_CHAT: 'anthropic/claude-sonnet-5',        // same model; kept as a separate name for the chat route
  GEMINI_FLASH: 'google/gemini-3.7-flash',         // via Google; half the price of the 3.5 it replaces
  // Heavy reasoning fallback and the native-speaker validator's judge — the
  // dialect quality ceiling, so it takes the newest Pro even though that one is
  // still preview-tier. Tolerable here specifically because the validator is
  // optional by design: `validateDialect` returns `unknown`/`ok:false` when its
  // provider is unavailable, so a deprecated id degrades the gate rather than
  // failing the request behind it.
  GEMINI_PRO: 'google/gemini-3.1-pro-preview',
  // The UTILITY lineup's model — and, despite the name, the one most of the
  // app's learner-facing Arabic is generated with: set phrases, situational
  // phrases, souq retellings, jingle lyrics, mnemonics, reading Q&A and the
  // daily challenge all run through it.
  //
  // It is deliberately a full Flash tier and NOT the cheaper `-flash-lite`.
  // Lite saves ~$0.45/Mtok output, and on classification or extraction that
  // would be free money — but the dialect literature is that models under-
  // produce dialect because they are *reluctant* to, a post-training bias that
  // gets worse as models get smaller and more aligned (AL-QASIDA,
  // arXiv:2412.04193). Spending the app's highest-volume dialect path to save a
  // few cents per million tokens is the wrong side of that trade. Flash Lite
  // also has no published Arabic score; Gemini 3 Flash is measured at 92 on
  // Artificial Analysis's Arabic index, second only to Gemini 3.1 Pro.
  //
  // If a cheap tier is wanted later, split it by *output*: `-flash-lite` for
  // the calls whose answer is English or a label (CEFR scoring, clip
  // verification, trend triage), never for the ones that write Arabic.
  GEMINI_FAST: 'google/gemini-3.7-flash',
  // Reasoning-heavy generalist, used by analyze-meme and offered in the
  // curriculum-chat lineup. It was the transcript ensemble's fourth,
  // lower-weight translation seat until 2026-09-16 — see
  // TRANSCRIPT_TRANSLATION_DRAFTERS for why a 0.6 verifier made those
  // translations worse rather than safer. Pinned to the dated snapshot rather
  // than the bare `qwen/qwen3.8-max`, which is an *alias*: OpenRouter's catalogue
  // has no such entry and resolves the name to whichever snapshot Alibaba
  // currently points it at (today `-0902`). That is the same silent-drift trap
  // the bare `Fanar` alias is banned for — a model swap nobody committed —
  // except quieter, because the alias keeps answering either way.
  QWEN: 'qwen/qwen3.8-max-0902',
  // The transcript analyser's workhorse: the merge of the ASR transcripts, its
  // stricter retry, the vocabulary-and-grammar pass and the phrase shortcut.
  // These ran on this model until 2026-08-31, when centralising the pins moved
  // them onto QWEN above — the 2.4-trillion-parameter Max tier, whose reasoning
  // is mandatory and cannot go below "minimal". A whole-clip merge that this
  // model answers in well under a minute takes the Max tier minutes, and the
  // analyser's 300-second budget is shared with the translation ensemble that
  // runs after the merge: every second the merge spends is a second the
  // translations do not get, down to a floor where they time out and the
  // transcript lands without English. 235B-A22B (22B active) answers directly
  // unless asked to think, and its 8k output ceiling is exactly the merge's.
  QWEN_FAST: 'qwen/qwen3-235b-a22b',
  SABA: 'mistralai/mistral-saba',                  // Arabic-native 24B, via OpenRouter
  // Second drafter in generate-story: a non-Google, non-Anthropic voice so the
  // ensemble is not two models with one house style. Luna is the current small
  // GPT-5 tier and undercuts the gpt-5-mini it replaces.
  GPT_MINI: 'openai/gpt-5.6-luna',
  // All general Fanar work (merge fallback, meta enrichment, dialect
  // validation, curriculum chat) uses the pinned gen-2 model. Never use the
  // bare 'Fanar' alias (silently tracks gen 1, 4k ctx) and never use
  // 'Fanar-Sadiq' for non-religious content — it is the Islamic-RAG model.
  FANAR: 'Fanar-C-2-27B',
  // Jais 2 — Arabic-native, and the only model here running on hardware this
  // project rents rather than a vendor's catalogue. It is not on OpenRouter,
  // or on any pay-per-token API at all, so like Fanar it has no twin and
  // `aiGateway.canFallBack` deliberately leaves it alone.
  //
  // The `runpod/` prefix is a routing signal rather than a vendor namespace;
  // the worker is started with `--served-model-name` set to this id minus the
  // prefix. Only the 8B is carried: 16GB of weights on one 24GB GPU at
  // ~$0.69/hr while active, so a cold start is a 16GB pull and can still
  // answer inside a live request's timeout.
  //
  // Upstream also publishes a 70B. It is deliberately absent: 144GB across two
  // GPUs at ~$6.98/hr, with a cold start measured in minutes, which is only
  // economic amortised over batch work. Adding it back is an id here plus an
  // entry in aiGateway's RUNPOD_ENDPOINT_ENV — and it must never land on a
  // path a learner waits for.
  JAIS2_8B: 'runpod/jais-2-8b-chat',
  // HUMAIN M3 — a 428B mixture-of-experts Arabic model (23B active),
  // commissioned by Saudi Arabia's HUMAIN and served from HUMAIN Node behind an
  // OpenAI-shaped `/chat/completions`. The third Arabic-native model here, and
  // the third with no OpenRouter twin: like Fanar and Jais 2 it exists on
  // exactly one endpoint, so `aiGateway.canFallBack` deliberately leaves it
  // alone and every consumer has to be additive rather than load-bearing.
  //
  // The `humain/` prefix is the registry's usual vendor form and is stripped on
  // the wire, because Node serves the model under its bare id.
  //
  // The bare id and the base URL are both confirmed against HUMAIN Node's own
  // published docs (`humain-m3`, `https://api.node.humain.com/v1`), so the
  // earlier caveat here — that nobody had checked either against a live key —
  // no longer applies to the *name*. What is still per-key is **access**:
  // Node assigns availability per user across tiers, so a key without M3 gets
  // 404 `model_not_found` on a correct id. `GET /v1/models` remains the
  // authority on what a given key may call; `scripts/humain-models.ts` prints
  // it. Either way the blast radius is one degraded validator leg, never a
  // failed learner request — which is why this model entered the app there.
  HUMAIN_M3: 'humain/humain-m3',
} as const;

// ---- Named lineups (preferred entry point) ---------------------------------
export type LineupName = 'TRANSLATION' | 'CONTENT' | 'UTILITY' | 'REASONING';

export interface Lineup {
  drafters: string[];                              // models the ensemble/draft step uses
  judge: string;                                   // critic model for draft_critic / council
  strategy: 'solo' | 'ensemble' | 'draft_critic' | 'council';
}

export const MODEL_LINEUPS: Record<LineupName, Lineup> = {
  // Translation: parallel ensemble — Claude and Gemini both translate, brain
  // picks the lower-MSA-leak result. Claude routes via OpenRouter and Gemini
  // via Google; both use weighted Jaccard ranking inside aiBrain.runEnsemble.
  TRANSLATION: {
    drafters: [MODEL_IDS.CLAUDE, MODEL_IDS.GEMINI_FLASH],
    judge: MODEL_IDS.CLAUDE,
    strategy: 'ensemble',
  },
  // Content creation (stories, news, lessons, memes): Gemini drafts, Claude
  // critiques and rewrites for tone + dialect authenticity.
  CONTENT: {
    drafters: [MODEL_IDS.GEMINI_FLASH, MODEL_IDS.CLAUDE],
    judge: MODEL_IDS.CLAUDE,
    strategy: 'draft_critic',
  },
  // Utility: single fast model, one shot. Named for the call shape, not for a
  // price tier — see GEMINI_FAST above for why this is not the cheapest model
  // available.
  UTILITY: {
    drafters: [MODEL_IDS.GEMINI_FAST],
    judge: MODEL_IDS.GEMINI_FAST,
    strategy: 'solo',
  },
  // Reasoning: hardest tasks (lesson planning, council debates). Adds Pro Gemini
  // as a third verifier on top of the standard tandem.
  REASONING: {
    drafters: [MODEL_IDS.CLAUDE, MODEL_IDS.GEMINI_FLASH, MODEL_IDS.GEMINI_PRO],
    judge: MODEL_IDS.CLAUDE,
    strategy: 'council',
  },
};

export function getLineup(name: LineupName): Lineup {
  return MODEL_LINEUPS[name];
}

// ---- The Arabic-native roster ----------------------------------------------
//
// Four of the ids above are Arabic-native, and which of them judges a piece of
// Arabic used to be decided in two places that did not know about each other:
// `dialectValidator.ts` picked the standing leg and the tie-break ladder, and
// `analyze-gulf-arabic` pinned Fanar directly with a bare fetch. The second is
// why adding Jais 2 and then HUMAIN M3 to the registry changed nothing at all
// for transcription — the pipeline could not see them. These two orders are the
// single place that question is answered now.
//
// They are ordered by *judgment quality on Arabic*, then filtered by what each
// model costs to ask:
//
//   HUMAIN M3     428B MoE, further pre-trained on 1T+ Arabic-native tokens.
//                 HUMAIN's own eval puts it at 89.37% across seven Arabic
//                 benchmarks, ahead of Opus 5 (87.34) and GPT-5.6 SOL (87.30),
//                 leading five of the seven. The best instrument here by a
//                 wide margin, and hosted, so it has no cold start.
//   Fanar-C-2-27B QCRI's sovereign model, dialect-tuned and validated by
//                 native testers. Rationed: small daily allowances, which is
//                 what keeps it off any always-on slot.
//   Mistral Saba  24B, February 2025, and showing its age — other hosts have
//                 already deprecated it. Kept only as the fallback standing
//                 leg, because a cross-check that loses its Arabic side
//                 entirely is worse than one running an older Arabic model.
//   Jais 2 8B     The **small** Jais, and it must not be mistaken for the one
//                 the papers praise: 8B scores 57.89 on QIMMA against the
//                 70B's 65.81, so it is the weakest Arabic judge on this list,
//                 not a frontier one. It earns its rung on economics rather
//                 than quality — it runs on hardware this project rents, so
//                 unlike Fanar it has no allowance to spend — and it stays
//                 *behind* nothing it outscores. See MODEL_IDS.JAIS2_8B for
//                 why the 70B is deliberately not carried.

/**
 * Who takes the always-on Arabic seat in the two-model cross-check, best first.
 *
 * "Always-on" is the whole constraint. This leg runs on *every* validated
 * generation, so a rationed model cannot sit here — Fanar would spend its
 * allowance before lunch and then degrade to `ok: false` for the rest of the
 * day, which is a quality gate that switches itself off precisely when the app
 * is busiest. Jais 2 8B is excluded for the opposite reason: it is cheap to ask
 * but the weakest judge here, and the standing leg is the one slot where being
 * asked every time makes quality matter most.
 *
 * Saba is second rather than absent because the consumer falls back to the
 * first *routable* entry: with no HUMAIN key the cross-check keeps an Arabic
 * opinion instead of silently collapsing to the generalist judge alone.
 */
export const ARABIC_STANDING_LEG_ORDER: string[] = [
  MODEL_IDS.HUMAIN_M3,
  MODEL_IDS.SABA,
];

/**
 * Who judges Arabic in the slots that fire *occasionally*, best first.
 *
 * Two consumers, and they share this list because they share the economics:
 * the validator's tie-break (only when the standing legs split) and the
 * transcript pipeline's per-video dialect check. Neither runs per generation,
 * which is what makes the rationed and the cold options affordable here when
 * they are not affordable in the standing seat.
 *
 * The order is *not* pure quality, and the exception is deliberate. Jais 2 8B
 * sits ahead of Fanar despite being the weaker judge, because Fanar is the only
 * rationed model here and the cheapest way to protect a small daily allowance
 * is to spend an unrationed opinion first. The transcript pipeline makes that
 * concrete: it already spends one Fanar call per video on meta enrichment, so a
 * second one for the dialect check would double its burn on the engine most
 * likely to run out. Walking down means Fanar is asked when the free options
 * are absent or asleep — which is the case its allowance is actually for.
 *
 * Consumers serving an always-on slot from `ARABIC_STANDING_LEG_ORDER` must
 * skip whichever entry took that seat: asking the same model the same question
 * twice buys no new information and spends a rung to learn nothing.
 */
export const ARABIC_OCCASIONAL_ORDER: string[] = [
  MODEL_IDS.HUMAIN_M3,
  MODEL_IDS.JAIS2_8B,
  MODEL_IDS.FANAR,
];

/**
 * Who drafts the transcript pipeline's English, in `analyze-gulf-arabic`.
 *
 * Three co-equal peers: Claude and Gemini as the generalists, HUMAIN M3 as the
 * Arabic-native one. The weights are `MODEL_WEIGHTS`, and `mergeOneLine` there
 * decides by weight rather than by name, so this list *is* the lineup. Order
 * matters only for ties: a full disagreement goes to the heaviest candidate
 * listed first.
 *
 * The pipeline includes M3 only when its route is configured
 * (`tryChatRoute`), the same way Jais 2 is silently absent without an
 * endpoint id — a deployment without a HUMAIN key runs the two-generalist
 * ensemble, with no failed rung in its provenance. Because a drafter that
 * disagrees is one of the parties, M3 is not asked to arbitrate a dispute it
 * drafted in; that walk goes on to Jais 2 and Fanar.
 *
 * **Qwen 3.8 Max was the fourth seat and was removed on 2026-09-16**, because
 * at weight 0.6 it could not help and could only hurt. Work through what it
 * actually decided: when two peers agree the consensus rule settles the line
 * before weight is consulted, so Qwen changes nothing. Its *only* decisive
 * moment was the three-way peer split — the hardest, most nuance-sensitive
 * line in the clip — where joining one peer's cluster reached the 1.5 bar
 * (1.0 + 0.6) and won the line **and cleared `needs_review`**. So the weakest
 * and most literal drafter in the lineup was settling exactly the lines the
 * Arabic-native arbiter exists to settle, and suppressing the flag that would
 * have sent them there. Removing it converts those lines back into disputes,
 * which is what they are.
 *
 * Its other costs were latency and spend: the Max tier's reasoning is
 * *mandatory* (see REASONING_FLOOR), so it was routinely the slowest drafter,
 * and the ensemble finishes when its slowest drafter does — on a 300-second
 * run budget shared with everything after it. That reclaimed time is what pays
 * for the peers' restored reasoning; see `TRANSLATION_REASONING` in
 * analyze-gulf-arabic.
 *
 * This does not retire `MODEL_IDS.QWEN`: it still serves analyze-meme and the
 * curriculum-chat lineup, and `QWEN_FAST` is still the analyser's workhorse
 * for the merge and the vocabulary pass. It is only no longer a translator.
 *
 * Distinct from `MODEL_LINEUPS.TRANSLATION`, which serves every other
 * translation caller through the Brain; M3 has not been added there.
 */
export const TRANSCRIPT_TRANSLATION_DRAFTERS: string[] = [
  MODEL_IDS.CLAUDE,
  MODEL_IDS.GEMINI_FLASH,
  MODEL_IDS.HUMAIN_M3,
];

// ---- Aliases consumed by aiBrain.ts ----------------------------------------
// These intentionally point at the CONTENT lineup so changing the tandem in
// one place propagates to every brain caller that doesn't pass models[].
export const DEFAULT_FAST = MODEL_IDS.GEMINI_FAST;
export const DEFAULT_JUDGE = MODEL_LINEUPS.CONTENT.judge;
export const DEFAULT_DRAFTERS = MODEL_LINEUPS.TRANSLATION.drafters;
// The learner-facing Ask AI text chat: instruction-following and dialect
// quality matter more than raw speed here, so it gets the newest Sonnet
// rather than the cheap utility default. Routes via OpenRouter.
export const DEFAULT_CHAT = MODEL_IDS.CLAUDE_CHAT;

// ---- Image models -----------------------------------------------------------
// Same rule as the text models: named here, never in a feature function.
// `aiGateway.generateImage` walks these in order — Gemini first because the
// house illustration style was tuned on it, OpenAI's image model as the
// fallback when Google is unavailable or refuses a prompt.
export const IMAGE_MODEL_IDS = {
  GEMINI: 'google/gemini-3.1-flash-image',
  // OpenAI's current image model. Note the id is deliberately not an
  // OpenRouter-namespaced one: this model is only ever called on OpenAI's own
  // Images API, where it is `gpt-image-2` (OpenRouter lists the same model as
  // `openai/gpt-5.4-image-2`, which that API would not recognise).
  OPENAI: 'openai/gpt-image-2',
} as const;

// ---- Reasoning ---------------------------------------------------------------
//
// Whether a model thinks before it answers is a provider default, and the
// defaults changed under this app on 2026-08-31 without anything here asking
// for it. Every model the pipeline ran on before that date answered directly
// unless a request enabled reasoning; every model in the lineup that replaced
// them reasons by default — OpenRouter's own metadata has Sonnet 5 at
// `default_effort: "high"` and Qwen 3.8 Max at `"xhigh"` with reasoning
// *mandatory*, and Google runs Gemini 3.x Flash at "medium". The transcript
// merge, which writes a whole clip fully voweled inside JSON, went from a
// forty-second call to one that thought for minutes first and then spent its
// output budget on the thinking — which is what a video "timing out" and a
// transcript arriving as one untranslated line both were.
//
// So `aiGateway.chatFetch` asks for the *lowest* level a model allows unless
// its caller says otherwise: `"none"` where reasoning can be switched off,
// the model's floor where it cannot. The floor is looked up here, next to the
// id, because it is a property of the model and not of the call — and because
// OpenRouter answers 400 to an effort a model does not support, so a guess is
// not good enough. When adding a model, read its `reasoning` block on
// https://openrouter.ai/api/v1/models (`mandatory`, `supported_efforts`).
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const REASONING_FLOOR: Record<string, 'none' | 'minimal' | 'low'> = {
  [MODEL_IDS.CLAUDE]: 'none',         // optional; supports low…max when on
  [MODEL_IDS.GPT_MINI]: 'none',       // optional; "none" is in its supported list
  [MODEL_IDS.QWEN]: 'minimal',        // mandatory; minimal is its floor
  [MODEL_IDS.QWEN_FAST]: 'none',      // hybrid; answers directly unless asked to think
  [MODEL_IDS.GEMINI_FLASH]: 'low',    // mandatory; Gemini 3.7 Flash offers low/medium/high
  [MODEL_IDS.GEMINI_PRO]: 'low',      // mandatory; same three levels
  [MODEL_IDS.JAIS2_8B]: 'none',       // not a reasoning model; plain vLLM takes no effort field
  // M3's limited-preview tier documents thinking as *off*, and the research
  // tier as available. Which tier a key buys is not visible from here, and
  // nothing in the app has asked M3 to think, so it is floored at "none" and
  // `reasoningFieldFor` sends it no field at all until the shape is confirmed
  // against a live key — the Fanar treatment, for the same reason: a guess
  // costs a round trip on every call.
  [MODEL_IDS.HUMAIN_M3]: 'none',
};

/**
 * The least reasoning `model` can be asked to do.
 *
 * Unknown ids fall back by vendor: Gemini 3.x cannot be switched off, so it
 * gets "low"; Qwen's current Max tier is mandatory with a "minimal" floor;
 * anything else is asked for none. A wrong guess is not fatal — the gateway
 * retries a rejected default without it — but it costs a round trip.
 */
export function reasoningFloor(model: string): 'none' | 'minimal' | 'low' {
  const known = REASONING_FLOOR[model];
  if (known) return known;
  if (/^google\//.test(model)) return 'low';
  if (/^qwen\//.test(model)) return 'minimal';
  return 'none';
}

// ---- Voting weights for runEnsemble ranking --------------------------------
// Claude Sonnet 5 and Gemini 3.7 Flash are co-equal authoritative drafters.
// Qwen and the second GPT drafter stay at lower weights.
export const MODEL_WEIGHTS: Record<string, number> = {
  [MODEL_IDS.CLAUDE]: 1.0,
  // Equal to the two generalist peers, by decision rather than by eval
  // (2026-09-14): the transcript ensemble's disputes went to the Arabic-native
  // roster, but a line all the generalists misread the same way never became
  // a dispute, so the strongest Arabic model in the registry had no say on
  // exactly the lines it exists to catch. At 1.0 it can make a consensus with
  // one peer and can turn two peers' agreement into a three-way split — an
  // equal vote, not a veto. See TRANSCRIPT_TRANSLATION_DRAFTERS.
  [MODEL_IDS.HUMAIN_M3]: 1.0,
  // GEMINI_FLASH and GEMINI_FAST are the same model today, so there is one
  // entry rather than two — a second key would be a duplicate-property error,
  // and the weight belongs to the model, not to the lineup slot.
  [MODEL_IDS.GEMINI_FLASH]: 1.0,
  [MODEL_IDS.GEMINI_PRO]: 0.9,
  // Kept at its verifier weight for the callers that still use it. Nothing in
  // the transcript ensemble reads it any more; see
  // TRANSCRIPT_TRANSLATION_DRAFTERS.
  [MODEL_IDS.QWEN]: 0.6,
  [MODEL_IDS.SABA]: 0.7,
  [MODEL_IDS.GPT_MINI]: 0.6,  // second drafter in generate-story
};

export function getModelWeight(id: string): number {
  return MODEL_WEIGHTS[id] ?? 0.8;
}
