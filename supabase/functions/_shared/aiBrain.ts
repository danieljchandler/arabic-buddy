// AI Brain — a small multi-model orchestrator for dialect-sensitive generation.
// Edge functions call askBrain() instead of fetching the gateway directly so every
// flow inherits: dialect identity prompt, structured-output, ensemble consensus,
// MSA-leak detection, and one repair pass.

import {
  getDialectIdentity,
  getDialectVocabRules,
  getDialectLabel,
  getDialectForbiddenTokens,
  primeDialectPrompt,
  type Dialect,
} from './dialectHelpers.ts';
import { detectMsaLeaks, type MsaLeakResult } from './msaLeakDetector.ts';
import { logMsaViolations, logValidatorResult } from './msaViolationLogger.ts';
import { validateDialect, type ValidatorResult } from './dialectValidator.ts';
import {
  DEFAULT_FAST,
  DEFAULT_JUDGE,
  DEFAULT_DRAFTERS,
  getModelWeight,
} from './modelRegistry.ts';

// Helper: scan with both hardcoded and rulebook-derived forbidden tokens.
function scanLeaks(text: string, dialect: Dialect): MsaLeakResult {
  return detectMsaLeaks(text, dialect, getDialectForbiddenTokens(dialect));
}

export type Strategy = 'solo' | 'ensemble' | 'draft_critic' | 'council';

export type MultimodalContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

export interface BrainTask {
  purpose: string;
  dialect: Dialect;
  userPrompt: MultimodalContent;
  systemPromptExtra?: string;
  strategy?: Strategy;
  tool?: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  models?: string[];
  maxTokens?: number;
  temperature?: number;
  arabicTextPath?: (parsed: unknown) => string;
  /** When true, skip the MSA repair pass (for low-stakes internal calls). */
  skipRepair?: boolean;
  /** When true, run a strict native-speaker validator after the repair pass. */
  validateDialect?: boolean;
}

export interface BrainResult<T = unknown> {
  output: T;
  raw: string;
  strategy: Strategy;
  models: string[];
  agreementScore: number;
  msaLeaks: MsaLeakResult;
  msaRepairs: number;
  totalLatencyMs: number;
  /** Set when validateDialect was requested and the validator returned a result. */
  validator?: ValidatorResult;
}

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Models that aren't on the Lovable AI Gateway catalog and must go through
// OpenRouter (uses OPENROUTER_API_KEY). Everything else goes through Lovable.
function routeForModel(model: string): 'openrouter' | 'lovable' {
  if (/^(anthropic|qwen|meta-llama|mistralai|deepseek|x-ai)\//.test(model)) return 'openrouter';
  return 'lovable';
}

class BrainHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ----------------- Public entry point -----------------

export async function askBrain<T = unknown>(task: BrainTask): Promise<BrainResult<T>> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) throw new BrainHttpError(500, 'LOVABLE_API_KEY not configured');

  await primeDialectPrompt(task.dialect);

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

  // MSA-guard + one repair pass when leaks are detected (all strategies).
  // Callers may opt out with skipRepair for truly low-stakes internal calls.
  if (!task.skipRepair && result.msaLeaks.leaks.length > 0) {
    try {
      const repaired = await runRepair<T>(task, result, apiKey);
      result = { ...repaired, msaRepairs: result.msaRepairs + 1 };
    } catch (err) {
      console.warn('[aiBrain] repair pass failed, returning original', err);
    }
  }

  // Optional native-validator pass (strict native-speaker reviewer).
  if (task.validateDialect) {
    try {
      const scanText = extractScanText(task, result.output, result.raw);
      const v = await validateDialect(scanText, task.dialect, { apiKey });
      result.validator = v;
      if (v.ok && (v.verdict === 'rewrite' || v.leaks.length > 0)) {
        logValidatorResult({
          dialect: task.dialect,
          result: v,
          offendingText: scanText,
          sourceFunction: task.purpose,
          metadata: { strategy: result.strategy, models: result.models },
        });
      }
    } catch (err) {
      console.warn('[aiBrain] validator pass failed', err);
    }
  }

  result.totalLatencyMs = Date.now() - start;

  if (result.msaLeaks?.leaks?.length) {
    logMsaViolations({
      dialect: task.dialect,
      leaks: result.msaLeaks,
      offendingText: result.raw ?? '',
      sourceFunction: task.purpose,
      metadata: {
        strategy: result.strategy,
        models: result.models,
        repairs: result.msaRepairs,
        post_repair: true,
      },
    });
  }


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
  const isGpt5 = /^openai\/gpt-5/.test(opts.model);
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  };
  const tokens = opts.maxTokens ?? 1024;
  if (isGpt5) body.max_completion_tokens = tokens;
  else body.max_tokens = tokens;
  // GPT-5 models only support default temperature; skip the field for them.
  if (!isGpt5) body.temperature = opts.temperature ?? 0.5;

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

  const route = routeForModel(opts.model);
  let url: string;
  let authKey: string | undefined;
  if (route === 'openrouter') {
    url = OPENROUTER_URL;
    authKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!authKey) {
      throw new BrainHttpError(500, `OPENROUTER_API_KEY not configured (required for ${opts.model})`);
    }
  } else {
    url = GATEWAY_URL;
    authKey = opts.apiKey;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new BrainHttpError(res.status, `${route} ${opts.model} ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  if (opts.tool) {
    const tc = msg?.tool_calls?.[0];
    const args = tc?.function?.arguments;
    if (args) {
      try {
        return { raw: args, parsed: JSON.parse(args) };
      } catch {
        throw new BrainHttpError(500, `${opts.model} returned invalid JSON in tool call`);
      }
    }
    // Fallback: some models (notably gpt-5 on long judge prompts) skip the
    // tool_call and return JSON in message.content instead. Salvage it.
    const content = typeof msg?.content === 'string' ? msg.content : '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        console.warn(`[aiBrain] ${opts.model} skipped tool_call; parsed JSON from content fallback`);
        return { raw: jsonMatch[0], parsed };
      } catch {
        /* fall through to error */
      }
    }
    throw new BrainHttpError(500, `${opts.model} returned no tool call and no parsable JSON content`);
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

const STABLE_FALLBACKS = ['google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'google/gemini-3-flash-preview'];

async function callModelWithFallback(opts: CallOptions): Promise<{ raw: string; parsed: unknown; model: string }> {
  try {
    const r = await callModel(opts);
    return { ...r, model: opts.model };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Retry on tool-call/parse failures — common with preview models.
    const recoverable = /no tool call|invalid JSON|no parsable JSON|5\d\d/.test(msg);
    if (!recoverable) throw err;
    for (const fb of STABLE_FALLBACKS) {
      if (fb === opts.model) continue;
      try {
        console.warn(`[aiBrain] ${opts.model} failed (${msg.slice(0, 120)}), falling back to ${fb}`);
        const r = await callModel({ ...opts, model: fb });
        return { ...r, model: fb };
      } catch { /* try next */ }
    }
    throw err;
  }
}

async function runSolo<T>(task: BrainTask, apiKey: string): Promise<BrainResult<T>> {
  const model = task.models?.[0] ?? DEFAULT_FAST;
  const { raw, parsed, model: usedModel } = await callModelWithFallback({
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
    models: [usedModel],
    agreementScore: 1,
    msaLeaks: scanLeaks(text, task.dialect),
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

  // Rank by weighted leak score (leaks / weight) — lower is better.
  // Qwen (weight 0.6) only wins when Gemini & Claude both have strictly more leaks.
  // Tiebreak by raw length (shorter = tighter).
  const ranked = successes
    .map(({ s, model }) => {
      const text = extractScanText(task, s.value.parsed, s.value.raw);
      const leaks = scanLeaks(text, task.dialect);
      const weight = getModelWeight(model);
      const score = leaks.leaks.length / weight;
      return { model, parsed: s.value.parsed, raw: s.value.raw, leaks, text, weight, score };
    })
    .sort((a, b) => a.score - b.score || a.raw.length - b.raw.length);

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
    : ['google/gemini-3.1-pro-preview', DEFAULT_JUDGE];

  const sys = buildSystem(task);
  const draft = await callModelWithFallback({
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
  const critiqued = await callModelWithFallback({
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
    models: [draft.model, critiqued.model],
    agreementScore: 1,
    msaLeaks: scanLeaks(text, task.dialect),
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

  const judgeSys = `${sys}\n\nYou are the judge. You are given ${ok.length} candidate responses, each labeled with a trust weight (1.0 = peer, <1.0 = verifier/tiebreaker). Prefer the higher-weight candidates; only side with a lower-weight candidate when the higher-weight ones clearly drift to MSA or another dialect. Merge the best phrasing if helpful. Never use MSA. Return ONLY the final answer in the same format as the candidates (no commentary).`;
  const judgeUser = `Original request:\n${stringifyUserPrompt(task.userPrompt)}\n\nCandidates:\n${ok
    .map((x, i) => `--- Candidate ${i + 1} (${x.model}, weight: ${getModelWeight(x.model).toFixed(1)}) ---\n${x.d.value.raw}`)
    .join('\n\n')}`;

  let final: { raw: string; parsed: unknown };
  let judgeUsed = true;
  try {
    final = await callModel({
      model: judge,
      system: judgeSys,
      user: judgeUser,
      tool: task.tool,
      maxTokens: task.maxTokens,
      temperature: 0.3,
      apiKey,
    });
  } catch (e) {
    console.warn(`[council] judge ${judge} failed, falling back to first successful draft:`, (e as Error)?.message);
    judgeUsed = false;
    final = ok[0].d.value;
  }

  const text = extractScanText(task, final.parsed, final.raw);
  return {
    output: final.parsed as T,
    raw: final.raw,
    strategy: 'council',
    models: judgeUsed ? [...ok.map((x) => x.model), judge] : ok.map((x) => x.model),
    agreementScore: ok.length / drafters.length,
    msaLeaks: scanLeaks(text, task.dialect),
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
    msaLeaks: scanLeaks(text, task.dialect),
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

// ----------------- Streaming entry point -----------------

export interface StreamBrainTask {
  purpose: string;
  dialect: Dialect;
  /** Prior conversation messages (excluding the system prompt — that is built here). */
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  systemPromptExtra?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Called once after the upstream stream finishes, with the accumulated assistant text.
   *  Use it to fire-and-forget MSA leak logging. Never throws to the caller. */
  onComplete?: (fullText: string) => void | Promise<void>;
  /** Optional CORS / extra headers to merge into the streamed Response. */
  responseHeaders?: Record<string, string>;
  /** Forward client abort signal so the upstream call cancels too. */
  signal?: AbortSignal;
}

/** Stream a single-model dialect-aware chat response through the Lovable gateway.
 *  Returns a Response with text/event-stream body, ready to return from a Deno handler. */
export async function streamBrain(task: StreamBrainTask): Promise<Response> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) throw new BrainHttpError(500, 'LOVABLE_API_KEY not configured');

  await primeDialectPrompt(task.dialect);

  const model = task.model ?? 'google/gemini-3.1-pro-preview';
  const isGpt5 = /^openai\/gpt-5/.test(model);

  const system = buildSystem({
    purpose: task.purpose,
    dialect: task.dialect,
    userPrompt: '',
    systemPromptExtra: task.systemPromptExtra,
  } as BrainTask);

  // Drop any client-supplied system messages — we own the system prompt here.
  const userMessages = task.messages.filter((m) => m.role !== 'system');

  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: [{ role: 'system', content: system }, ...userMessages],
  };
  const tokens = task.maxTokens ?? 1024;
  if (isGpt5) body.max_completion_tokens = tokens;
  else body.max_tokens = tokens;
  if (!isGpt5) body.temperature = task.temperature ?? 0.7;

  const upstream = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: task.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    throw new BrainHttpError(upstream.status, `gateway stream ${model} ${upstream.status}: ${text.slice(0, 200)}`);
  }

  // Tap the stream so we can accumulate the assistant text for MSA leak logging,
  // while passing every byte through to the client unchanged.
  const accumulator: string[] = [];
  const decoder = new TextDecoder();
  let sseBuffer = '';

  const tap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      try {
        sseBuffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = sseBuffer.indexOf('\n')) !== -1) {
          const line = sseBuffer.slice(0, nl).trim();
          sseBuffer = sseBuffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content;
            if (typeof delta === 'string') accumulator.push(delta);
          } catch { /* ignore partial chunks */ }
        }
      } catch { /* never break the passthrough */ }
    },
    flush() {
      const full = accumulator.join('');
      if (full && task.dialect) {
        try {
          const leaks = scanLeaks(full, task.dialect);
          if (leaks.leaks.length > 0) {
            console.warn(`[aiBrain.stream] MSA leak in ${task.purpose} (${task.dialect}):`, leaks.leaks.join(', '));
            logMsaViolations({
              dialect: task.dialect,
              leaks,
              offendingText: full,
              sourceFunction: task.purpose,
              metadata: { streaming: true, model: task.model ?? 'google/gemini-3.1-pro-preview' },
            });
            // Fire-and-forget a repair call so callers with onComplete can get
            // the corrected text (e.g., conversation-practice buffers the stream).
            if (task.onComplete) {
              const apiKey = Deno.env.get('LOVABLE_API_KEY');
              if (apiKey && leaks.severity !== 'none') {
                const repairSys = `${buildSystem({ purpose: task.purpose, dialect: task.dialect, userPrompt: '', systemPromptExtra: task.systemPromptExtra } as BrainTask)}\n\nThe previous output leaked MSA. Rewrite it in authentic ${getDialectLabel(task.dialect)} ONLY. The following MSA words MUST be replaced with dialectal equivalents: ${leaks.leaks.join(', ')}. Return ONLY the corrected text (no commentary).`;
                fetch(GATEWAY_URL, {
                  method: 'POST',
                  headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    model: DEFAULT_FAST,
                    max_tokens: 600,
                    temperature: 0.2,
                    messages: [
                      { role: 'system', content: repairSys },
                      { role: 'user', content: full },
                    ],
                  }),
                }).then(async (r) => {
                  if (!r.ok) return;
                  const d = await r.json();
                  const corrected = d?.choices?.[0]?.message?.content;
                  if (corrected && typeof corrected === 'string') {
                    try { Promise.resolve(task.onComplete!(corrected)).catch(() => {}); } catch { /* ignore */ }
                  }
                }).catch(() => {});
              }
            }
          }
        } catch { /* ignore */ }
      }
      if (task.onComplete) {
        try { Promise.resolve(task.onComplete(full)).catch(() => {}); } catch { /* ignore */ }
      }
    },
  });

  const headers = new Headers(task.responseHeaders ?? {});
  headers.set('Content-Type', 'text/event-stream');

  return new Response(upstream.body.pipeThrough(tap), { headers });
}
