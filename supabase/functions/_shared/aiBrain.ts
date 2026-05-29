// AI Brain — a small multi-model orchestrator for dialect-sensitive generation.
// Edge functions call askBrain() instead of fetching the gateway directly so every
// flow inherits: dialect identity prompt, structured-output, ensemble consensus,
// MSA-leak detection, and one repair pass.

import {
  getDialectIdentity,
  getDialectVocabRules,
  getDialectLabel,
  type Dialect,
} from './dialectHelpers.ts';
import { detectMsaLeaks, type MsaLeakResult } from './msaLeakDetector.ts';
import {
  DEFAULT_FAST,
  DEFAULT_JUDGE,
  DEFAULT_DRAFTERS,
} from './modelRegistry.ts';

export type Strategy = 'solo' | 'ensemble' | 'draft_critic' | 'council';

export type MultimodalContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

export interface BrainTask {
  purpose: string;
  dialect: Dialect;
  userPrompt: MultimodalContent;
  systemPromptExtra?: string; // appended after dialect identity block
  strategy?: Strategy;
  /** OpenAI-style function tool for structured output. */
  tool?: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  models?: string[]; // override which models to use
  maxTokens?: number;
  temperature?: number;
  /** Where to extract the dialect-Arabic text from the parsed output for leak scanning.
   *  If omitted, the brain scans the raw text response or JSON.stringify(output). */
  arabicTextPath?: (parsed: unknown) => string;
}

export interface BrainResult<T = unknown> {
  output: T;
  raw: string;
  strategy: Strategy;
  models: string[];
  agreementScore: number; // 0-1, only meaningful for ensemble
  msaLeaks: MsaLeakResult;
  msaRepairs: number;
  totalLatencyMs: number;
}

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

class BrainHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ----------------- Public entry point -----------------

export async function askBrain<T = unknown>(task: BrainTask): Promise<BrainResult<T>> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) throw new BrainHttpError(500, 'LOVABLE_API_KEY not configured');

  const strategy: Strategy = task.strategy ?? pickStrategy(task.purpose);
  const start = Date.now();

  let result: BrainResult<T>;
  switch (strategy) {
    case 'solo':
      result = await runSolo<T>(task, apiKey);
      break;
    case 'ensemble':
      result = await runEnsemble<T>(task, apiKey);
      break;
    case 'draft_critic':
      result = await runDraftCritic<T>(task, apiKey);
      break;
    case 'council':
      result = await runCouncil<T>(task, apiKey);
      break;
  }

  // MSA-guard + one repair pass for non-solo strategies.
  if (strategy !== 'solo' && result.msaLeaks.leaks.length > 0) {
    try {
      const repaired = await runRepair<T>(task, result, apiKey);
      result = { ...repaired, msaRepairs: result.msaRepairs + 1 };
    } catch (err) {
      console.warn('[aiBrain] repair pass failed, returning original', err);
    }
  }

  result.totalLatencyMs = Date.now() - start;
  return result;
}

// ----------------- Strategy picker -----------------

function pickStrategy(purpose: string): Strategy {
  switch (purpose) {
    case 'vocab_definition':
    case 'sample_sentences':
    case 'translation':
    case 'phrase_of_the_day':
      return 'ensemble';
    case 'story':
    case 'meme_explain':
    case 'news_summary':
      return 'draft_critic';
    case 'lesson_generation':
    case 'how_do_i_say':
      return 'council';
    default:
      return 'solo';
  }
}

// ----------------- Prompt builder -----------------

function buildSystem(task: BrainTask): string {
  const identity = getDialectIdentity(task.dialect);
  const rules = getDialectVocabRules(task.dialect);
  const extra = task.systemPromptExtra ? `\n\n${task.systemPromptExtra}` : '';
  return `${identity}\n\n${rules}${extra}`;
}

// ----------------- Single model call -----------------

interface CallOptions {
  model: string;
  system: string;
  user: MultimodalContent;
  tool?: BrainTask['tool'];
  maxTokens?: number;
  temperature?: number;
  apiKey: string;
}

async function callModel(opts: CallOptions): Promise<{ raw: string; parsed: unknown }> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.5,
  };

  if (opts.tool) {
    body.tools = [
      {
        type: 'function',
        function: {
          name: opts.tool.name,
          description: opts.tool.description,
          parameters: opts.tool.parameters,
        },
      },
    ];
    body.tool_choice = { type: 'function', function: { name: opts.tool.name } };
  }

  const res = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new BrainHttpError(res.status, `gateway ${opts.model} ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  if (opts.tool) {
    const tc = msg?.tool_calls?.[0];
    const args = tc?.function?.arguments;
    if (!args) throw new BrainHttpError(500, `${opts.model} returned no tool call`);
    try {
      return { raw: args, parsed: JSON.parse(args) };
    } catch {
      throw new BrainHttpError(500, `${opts.model} returned invalid JSON`);
    }
  }
  const raw = msg?.content ?? '';
  // Try to extract JSON if it looks like JSON.
  const jsonMatch = typeof raw === 'string' ? raw.match(/\{[\s\S]*\}/) : null;
  let parsed: unknown = raw;
  if (jsonMatch) {
    try { parsed = JSON.parse(jsonMatch[0]); } catch { /* keep raw */ }
  }
  return { raw, parsed };
}

// ----------------- Strategies -----------------

async function runSolo<T>(task: BrainTask, apiKey: string): Promise<BrainResult<T>> {
  const model = task.models?.[0] ?? DEFAULT_FAST;
  const { raw, parsed } = await callModel({
    model,
    system: buildSystem(task),
    user: task.userPrompt,
    tool: task.tool,
    maxTokens: task.maxTokens,
    temperature: task.temperature,
    apiKey,
  });
  const text = extractScanText(task, parsed, raw);
  return {
    output: parsed as T,
    raw,
    strategy: 'solo',
    models: [model],
    agreementScore: 1,
    msaLeaks: detectMsaLeaks(text, task.dialect),
    msaRepairs: 0,
    totalLatencyMs: 0,
  };
}

async function runEnsemble<T>(task: BrainTask, apiKey: string): Promise<BrainResult<T>> {
  const models = (task.models ?? DEFAULT_DRAFTERS).slice(0, 3);
  const sys = buildSystem(task);
  const settled = await Promise.allSettled(
    models.map((m) =>
      callModel({
        model: m,
        system: sys,
        user: task.userPrompt,
        tool: task.tool,
        maxTokens: task.maxTokens,
        temperature: task.temperature,
        apiKey,
      }),
    ),
  );
  const successes = settled
    .map((s, i) => ({ s, model: models[i] }))
    .filter((x) => x.s.status === 'fulfilled') as Array<{
      s: PromiseFulfilledResult<{ raw: string; parsed: unknown }>;
      model: string;
    }>;

  if (successes.length === 0) {
    const firstErr = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined;
    throw firstErr?.reason ?? new BrainHttpError(500, 'all ensemble models failed');
  }

  // Pick the candidate with the fewest MSA leaks; tiebreak by shortest raw.
  const ranked = successes
    .map(({ s, model }) => {
      const text = extractScanText(task, s.value.parsed, s.value.raw);
      const leaks = detectMsaLeaks(text, task.dialect);
      return { model, parsed: s.value.parsed, raw: s.value.raw, leaks, text };
    })
    .sort((a, b) => a.leaks.leaks.length - b.leaks.leaks.length || a.raw.length - b.raw.length);

  const winner = ranked[0];
  // Agreement = share of candidates with the same leak-count bucket as winner.
  const agree = ranked.filter((r) => r.leaks.leaks.length === winner.leaks.leaks.length).length / ranked.length;

  return {
    output: winner.parsed as T,
    raw: winner.raw,
    strategy: 'ensemble',
    models: successes.map((x) => x.model),
    agreementScore: agree,
    msaLeaks: winner.leaks,
    msaRepairs: 0,
    totalLatencyMs: 0,
  };
}

async function runDraftCritic<T>(task: BrainTask, apiKey: string): Promise<BrainResult<T>> {
  const [drafter, critic] = task.models && task.models.length >= 2
    ? task.models
    : ['google/gemini-2.5-pro', DEFAULT_JUDGE];

  const sys = buildSystem(task);
  const draft = await callModel({
    model: drafter,
    system: sys,
    user: task.userPrompt,
    tool: task.tool,
    maxTokens: task.maxTokens,
    temperature: task.temperature,
    apiKey,
  });

  const criticSys = `${sys}\n\nYou are reviewing a draft. If anything drifts to MSA or another dialect, REWRITE it in authentic ${getDialectLabel(task.dialect)}. Return ONLY the corrected output in the same format as the draft (no commentary).`;
  const criticUser = `Original request:\n${stringifyUserPrompt(task.userPrompt)}\n\nDraft to review:\n${draft.raw}`;
  const critiqued = await callModel({
    model: critic,
    system: criticSys,
    user: criticUser,
    tool: task.tool,
    maxTokens: task.maxTokens,
    temperature: 0.3,
    apiKey,
  });

  const text = extractScanText(task, critiqued.parsed, critiqued.raw);
  return {
    output: critiqued.parsed as T,
    raw: critiqued.raw,
    strategy: 'draft_critic',
    models: [drafter, critic],
    agreementScore: 1,
    msaLeaks: detectMsaLeaks(text, task.dialect),
    msaRepairs: 0,
    totalLatencyMs: 0,
  };
}

async function runCouncil<T>(task: BrainTask, apiKey: string): Promise<BrainResult<T>> {
  const drafters = (task.models ?? DEFAULT_DRAFTERS).slice(0, 3);
  const judge = DEFAULT_JUDGE;
  const sys = buildSystem(task);

  const drafts = await Promise.allSettled(
    drafters.map((m) =>
      callModel({
        model: m,
        system: sys,
        user: task.userPrompt,
        tool: task.tool,
        maxTokens: task.maxTokens,
        temperature: task.temperature ?? 0.7,
        apiKey,
      }),
    ),
  );
  const ok = drafts
    .map((d, i) => ({ d, model: drafters[i] }))
    .filter((x) => x.d.status === 'fulfilled') as Array<{
      d: PromiseFulfilledResult<{ raw: string; parsed: unknown }>;
      model: string;
    }>;
  if (ok.length === 0) {
    const firstErr = drafts.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined;
    throw firstErr?.reason ?? new BrainHttpError(500, 'all council drafters failed');
  }

  const judgeSys = `${sys}\n\nYou are the judge. You are given ${ok.length} candidate responses. Choose the most authentic ${getDialectLabel(task.dialect)} answer, merging the best phrasing if helpful. Never use MSA. Return ONLY the final answer in the same format as the candidates (no commentary).`;
  const judgeUser = `Original request:\n${stringifyUserPrompt(task.userPrompt)}\n\nCandidates:\n${ok
    .map((x, i) => `--- Candidate ${i + 1} (${x.model}) ---\n${x.d.value.raw}`)
    .join('\n\n')}`;

  const final = await callModel({
    model: judge,
    system: judgeSys,
    user: judgeUser,
    tool: task.tool,
    maxTokens: task.maxTokens,
    temperature: 0.3,
    apiKey,
  });

  const text = extractScanText(task, final.parsed, final.raw);
  return {
    output: final.parsed as T,
    raw: final.raw,
    strategy: 'council',
    models: [...ok.map((x) => x.model), judge],
    agreementScore: ok.length / drafters.length,
    msaLeaks: detectMsaLeaks(text, task.dialect),
    msaRepairs: 0,
    totalLatencyMs: 0,
  };
}

async function runRepair<T>(task: BrainTask, prior: BrainResult<T>, apiKey: string): Promise<BrainResult<T>> {
  const sys = `${buildSystem(task)}\n\nThe previous output leaked MSA. Rewrite it in authentic ${getDialectLabel(task.dialect)} ONLY. The following MSA words MUST be replaced with dialectal equivalents: ${prior.msaLeaks.leaks.join(', ')}. Return ONLY the corrected output in the same format (no commentary).`;
  const user = `Original request:\n${stringifyUserPrompt(task.userPrompt)}\n\nFlawed output to correct:\n${prior.raw}`;
  const { raw, parsed } = await callModel({
    model: DEFAULT_JUDGE,
    system: sys,
    user,
    tool: task.tool,
    maxTokens: task.maxTokens,
    temperature: 0.2,
    apiKey,
  });
  const text = extractScanText(task, parsed, raw);
  return {
    ...prior,
    output: parsed as T,
    raw,
    models: [...prior.models, DEFAULT_JUDGE],
    msaLeaks: detectMsaLeaks(text, task.dialect),
  };
}

function extractScanText(task: BrainTask, parsed: unknown, raw: string): string {
  if (task.arabicTextPath) {
    try { return task.arabicTextPath(parsed) ?? ''; } catch { /* fall through */ }
  }
  if (typeof parsed === 'string') return parsed;
  if (parsed && typeof parsed === 'object') {
    // Concatenate any string values that contain Arabic characters.
    const acc: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') {
        if (/[\u0600-\u06FF]/.test(v)) acc.push(v);
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
    };
    walk(parsed);
    if (acc.length) return acc.join(' ');
  }
  return raw;
}

function stringifyUserPrompt(p: MultimodalContent): string {
  if (typeof p === 'string') return p;
  return p
    .map((part) => (part.type === 'text' ? part.text : '[image]'))
    .join('\n');
}

export { BrainHttpError };
