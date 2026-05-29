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
    notes: 'Best Gemini for nuanced dialect output.',
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
    notes: 'Preferred judge/critic.',
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
export const DEFAULT_DRAFTERS = [
  'google/gemini-2.5-pro',
  'openai/gpt-5-mini',
  'google/gemini-3-flash-preview',
];
