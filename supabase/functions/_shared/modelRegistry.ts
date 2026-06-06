// Central registry of models available via Lovable AI Gateway.
// Strategies pick models by tag/tier so we can swap providers without touching call sites.

export type ModelTier = 'fast' | 'balanced' | 'strong';
export type ModelTag = 'dialect' | 'reasoning' | 'multimodal' | 'cheap' | 'judge';

export interface ModelSpec {
  id: string; // gateway model id
  tier: ModelTier;
  tags: ModelTag[];
  // Soft hints used by the brain for ordering / budgeting (not enforced):
  approxLatencyMs?: number;
  notes?: string;
}

export const MODELS: ModelSpec[] = [
  {
    id: 'google/gemini-3-flash-preview',
    tier: 'fast',
    tags: ['cheap', 'dialect'],
    approxLatencyMs: 1200,
    notes: 'Default fast model. Good for solo low-stakes calls.',
  },
  {
    id: 'google/gemini-2.5-flash',
    tier: 'fast',
    tags: ['dialect', 'cheap'],
    approxLatencyMs: 1400,
  },
  {
    id: 'google/gemini-2.5-pro',
    tier: 'strong',
    tags: ['dialect', 'reasoning', 'multimodal'],
    approxLatencyMs: 3500,
  },
  {
    id: 'google/gemini-3.1-pro-preview',
    tier: 'strong',
    tags: ['dialect', 'reasoning', 'multimodal'],
    approxLatencyMs: 4000,
    notes: 'Top Gemini for nuanced dialect output. Pipeline-aligned drafter.',
  },
  {
    id: 'anthropic/claude-opus-4.1',
    tier: 'strong',
    tags: ['dialect', 'reasoning', 'judge'],
    approxLatencyMs: 4500,
    notes: 'Pipeline-aligned drafter & judge. Strong instruction following.',
  },
  {
    id: 'qwen/qwen3-max',
    tier: 'strong',
    tags: ['dialect', 'reasoning'],
    approxLatencyMs: 4000,
    notes: 'Third verifier in ensemble; weighted lower than Gemini/Claude.',
  },
  {
    id: 'openai/gpt-5-mini',
    tier: 'balanced',
    tags: ['reasoning', 'dialect'],
    approxLatencyMs: 2200,
  },
  {
    id: 'openai/gpt-5',
    tier: 'strong',
    tags: ['reasoning', 'judge', 'dialect'],
    approxLatencyMs: 4000,
  },
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

export const DEFAULT_FAST = 'google/gemini-3-flash-preview';
export const DEFAULT_JUDGE = 'openai/gpt-5';
// Reverted from gemini-3.1-pro-preview / claude-opus-4.1 / qwen3-max because
// those IDs were unavailable on the Lovable AI Gateway and/or returned no
// tool_call on structured-output requests, causing askBrain to throw
// "returned no tool call and no parsable JSON content".
export const DEFAULT_DRAFTERS = [
  'google/gemini-2.5-pro',
  'openai/gpt-5',
  'openai/gpt-5-mini',
];

/**
 * Per-model voting weight used by the AI Brain's ensemble ranking.
 * Higher = more authoritative when picking the winning candidate.
 */
export const MODEL_WEIGHTS: Record<string, number> = {
  'google/gemini-2.5-pro': 1.0,
  'openai/gpt-5': 1.0,
  'openai/gpt-5-mini': 0.6,
};

export function getModelWeight(id: string): number {
  return MODEL_WEIGHTS[id] ?? 0.8;
}
