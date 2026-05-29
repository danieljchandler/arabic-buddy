// Native-speaker authenticity validator.
//
// After the brain produces dialect Arabic, this runs a single strong-model
// "native speaker reviewer" pass that scores authenticity 1-5 against the
// approved rulebook context already baked into the system prompt.

import {
  getDialectIdentity,
  getDialectVocabRules,
  getDialectLabel,
  type Dialect,
} from './dialectHelpers.ts';

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const VALIDATOR_MODEL = 'google/gemini-2.5-pro';

export interface ValidatorLeak {
  token: string;
  suggestion?: string;
  rule_id?: string;
  reason?: string;
}

export interface ValidatorResult {
  score: number;           // 1-5; 5 = fully authentic native, 1 = clearly MSA / wrong dialect
  verdict: 'pass' | 'rewrite';
  leaks: ValidatorLeak[];
  notes?: string;
  latencyMs: number;
  ok: boolean;             // false if the validator itself errored — caller should ignore result
}

export interface ValidateOptions {
  apiKey?: string;
  passThreshold?: number; // default 4
  maxChars?: number;      // truncate text for cost control; default 4000
  signal?: AbortSignal;
}

export async function validateDialect(
  text: string,
  dialect: Dialect,
  opts: ValidateOptions = {},
): Promise<ValidatorResult> {
  const start = Date.now();
  const apiKey = opts.apiKey ?? Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey || !text || !text.trim()) {
    return { score: 5, verdict: 'pass', leaks: [], latencyMs: 0, ok: false };
  }

  const passThreshold = opts.passThreshold ?? 4;
  const snippet = text.slice(0, opts.maxChars ?? 4000);

  const system = `${getDialectIdentity(dialect)}

${getDialectVocabRules(dialect)}

You are acting as a STRICT NATIVE-SPEAKER REVIEWER for ${getDialectLabel(dialect)}.
Your only job: judge whether the candidate text sounds like an authentic native ${dialect} speaker.
- Score 5: indistinguishable from a native — vocabulary, syntax, particles all authentic.
- Score 4: mostly authentic; minor stylistic awkwardness.
- Score 3: noticeable MSA influence OR borrowing from another dialect; would feel "off" to a native.
- Score 2: clearly MSA / wrong dialect in multiple places.
- Score 1: pure MSA or completely wrong dialect.
Be harsh. When in doubt between 4 and 3, choose 3.`;

  const tool = {
    name: 'emit_authenticity_score',
    description: 'Return a strict native-speaker authenticity judgment.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        score: { type: 'integer', minimum: 1, maximum: 5 },
        verdict: { type: 'string', enum: ['pass', 'rewrite'] },
        leaks: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              token: { type: 'string', description: 'The offending word or short phrase as it appears in the text.' },
              suggestion: { type: 'string', description: 'Authentic dialectal replacement.' },
              reason: { type: 'string', description: 'Short reason this is wrong for this dialect.' },
            },
            required: ['token'],
          },
        },
        notes: { type: 'string' },
      },
      required: ['score', 'verdict', 'leaks'],
    },
  };

  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: opts.signal,
      body: JSON.stringify({
        model: VALIDATOR_MODEL,
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Candidate text in ${dialect} Arabic to judge:\n\n${snippet}` },
        ],
        tools: [{ type: 'function', function: tool }],
        tool_choice: { type: 'function', function: { name: tool.name } },
      }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      console.warn('[dialectValidator] gateway error', res.status, msg.slice(0, 200));
      return { score: 5, verdict: 'pass', leaks: [], latencyMs: Date.now() - start, ok: false };
    }
    const data = await res.json();
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return { score: 5, verdict: 'pass', leaks: [], latencyMs: Date.now() - start, ok: false };
    let parsed: { score?: number; verdict?: string; leaks?: ValidatorLeak[]; notes?: string };
    try { parsed = JSON.parse(args); } catch {
      return { score: 5, verdict: 'pass', leaks: [], latencyMs: Date.now() - start, ok: false };
    }
    const score = Math.max(1, Math.min(5, Math.round(Number(parsed.score) || 5)));
    const verdict: 'pass' | 'rewrite' =
      parsed.verdict === 'rewrite' || score < passThreshold ? 'rewrite' : 'pass';
    const leaks = Array.isArray(parsed.leaks) ? parsed.leaks.filter((l) => l && typeof l.token === 'string') : [];
    return {
      score,
      verdict,
      leaks,
      notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
      latencyMs: Date.now() - start,
      ok: true,
    };
  } catch (err) {
    console.warn('[dialectValidator] failed', err);
    return { score: 5, verdict: 'pass', leaks: [], latencyMs: Date.now() - start, ok: false };
  }
}
