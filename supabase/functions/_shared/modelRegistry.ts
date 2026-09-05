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
  QWEN: 'qwen/qwen3.8-max',                        // third-leg verifier (weight 0.6)
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
  [MODEL_IDS.GEMINI_FLASH]: 'low',    // mandatory; Gemini 3.7 Flash offers low/medium/high
  [MODEL_IDS.GEMINI_PRO]: 'low',      // mandatory; same three levels
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
  // GEMINI_FLASH and GEMINI_FAST are the same model today, so there is one
  // entry rather than two — a second key would be a duplicate-property error,
  // and the weight belongs to the model, not to the lineup slot.
  [MODEL_IDS.GEMINI_FLASH]: 1.0,
  [MODEL_IDS.GEMINI_PRO]: 0.9,
  [MODEL_IDS.QWEN]: 0.6,
  [MODEL_IDS.SABA]: 0.7,
  [MODEL_IDS.GPT_MINI]: 0.6,  // second drafter in generate-story
};

export function getModelWeight(id: string): number {
  return MODEL_WEIGHTS[id] ?? 0.8;
}
