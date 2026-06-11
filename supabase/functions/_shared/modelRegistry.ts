// =============================================================================
// CENTRAL MODEL REGISTRY — single source of truth for all AI model selection.
// =============================================================================
//
// RULE: Do NOT hardcode model IDs in feature code. If a model breaks, fix the
// root cause (credits, routing, prompt) rather than silently swapping models
// in individual edge functions. Only swap models HERE, in one place.
//
// Two named lineups power everything translation- or content-related:
//   - TRANSLATION: Claude Sonnet 4.5 + Gemini 3.5 Flash, ensemble.
//   - CONTENT:    Claude Sonnet 4.5 + Gemini 3.5 Flash, draft_critic.
//
// Claude routes via OpenRouter (OPENROUTER_API_KEY); Gemini routes via the
// Lovable AI Gateway (LOVABLE_API_KEY). See routeForModel() in aiBrain.ts.
//
// Live voice (realtime-session-token) and ASR/TTS/image models are NOT
// governed by this registry — they have their own provider-specific configs.
// =============================================================================

export type ModelTier = 'fast' | 'balanced' | 'strong';
export type ModelTag = 'dialect' | 'reasoning' | 'multimodal' | 'cheap' | 'judge';

export interface ModelSpec {
  id: string;
  tier: ModelTier;
  tags: ModelTag[];
  approxLatencyMs?: number;
  notes?: string;
}

// ---- Canonical model IDs ----------------------------------------------------
// Bump these when upgrading; everything downstream picks it up automatically.
export const MODEL_IDS = {
  CLAUDE: 'anthropic/claude-sonnet-4.5',          // one tier below Opus (cheaper)
  GEMINI_FLASH: 'google/gemini-3.5-flash',         // via Lovable Gateway
  GEMINI_PRO: 'google/gemini-2.5-pro',             // heavy reasoning fallback
  GEMINI_FAST: 'google/gemini-3-flash-preview',    // cheapest utility default
  QWEN: 'qwen/qwen3-max',                          // third-leg verifier
  FANAR_SADIQ: 'Fanar-Sadiq',                      // cultural enrichment (Fanar API)
  FANAR_VALID: 'Fanar-C-2-27B',                    // dialect validation (Fanar API)
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
  // picks the lower-MSA-leak result. Both models route via OpenRouter/Lovable
  // and use weighted Jaccard ranking inside aiBrain.runEnsemble.
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
  // Utility: cheap classification, extraction, scoring — single fast model.
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

// ---- Legacy catalog (kept for tag-based pickModels callers) ----------------
export const MODELS: ModelSpec[] = [
  { id: MODEL_IDS.GEMINI_FAST,  tier: 'fast',     tags: ['cheap', 'dialect'],                       approxLatencyMs: 1200 },
  { id: 'google/gemini-2.5-flash', tier: 'fast',  tags: ['dialect', 'cheap'],                       approxLatencyMs: 1400 },
  { id: MODEL_IDS.GEMINI_FLASH, tier: 'balanced', tags: ['dialect', 'reasoning'],                   approxLatencyMs: 1600, notes: 'Default Gemini drafter (3.5 Flash).' },
  { id: MODEL_IDS.GEMINI_PRO,   tier: 'strong',   tags: ['dialect', 'reasoning', 'multimodal'],     approxLatencyMs: 3500 },
  { id: MODEL_IDS.CLAUDE,       tier: 'strong',   tags: ['dialect', 'reasoning', 'judge'],          approxLatencyMs: 3500, notes: 'Default tandem partner; cheaper than Opus.' },
  { id: 'anthropic/claude-opus-4.1', tier: 'strong', tags: ['dialect', 'reasoning', 'judge'],       approxLatencyMs: 4500, notes: 'Legacy — use Sonnet 4.5 instead.' },
  { id: MODEL_IDS.QWEN,         tier: 'strong',   tags: ['dialect', 'reasoning'],                   approxLatencyMs: 4000, notes: 'Lower-weight third verifier.' },
];

export function pickModels(tags: ModelTag[], count: number): string[] {
  const scored = MODELS.map((m) => ({
    id: m.id,
    score: tags.reduce((acc, t) => acc + (m.tags.includes(t) ? 1 : 0), 0),
    latency: m.approxLatencyMs ?? 9999,
  }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.latency - b.latency);
  return scored.slice(0, count).map((m) => m.id);
}

// ---- Aliases consumed by aiBrain.ts ----------------------------------------
// These intentionally point at the CONTENT lineup so changing the tandem in
// one place propagates to every brain caller that doesn't pass models[].
export const DEFAULT_FAST = MODEL_IDS.GEMINI_FAST;
export const DEFAULT_JUDGE = MODEL_LINEUPS.CONTENT.judge;
export const DEFAULT_DRAFTERS = MODEL_LINEUPS.TRANSLATION.drafters;

// ---- Voting weights for runEnsemble ranking --------------------------------
// Both Claude Sonnet 4.5 and Gemini 3.5 Flash are co-equal authoritative
// drafters. Qwen and other legacy models stay at lower weights.
export const MODEL_WEIGHTS: Record<string, number> = {
  [MODEL_IDS.CLAUDE]: 1.0,
  [MODEL_IDS.GEMINI_FLASH]: 1.0,
  [MODEL_IDS.GEMINI_PRO]: 0.9,
  'google/gemini-3.1-pro-preview': 0.9,
  'anthropic/claude-opus-4.1': 0.95,
  [MODEL_IDS.QWEN]: 0.6,
  'openai/gpt-5': 0.8,
  'openai/gpt-5-mini': 0.6,
};

export function getModelWeight(id: string): number {
  return MODEL_WEIGHTS[id] ?? 0.8;
}
