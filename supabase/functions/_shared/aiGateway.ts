// =============================================================================
// AI GATEWAY — which upstream actually receives a model call.
// =============================================================================
//
// `modelRegistry.ts` answers *which model*; this module answers *whose API*.
// The two were tangled while every non-Anthropic model went through the
// Lovable AI Gateway: the model id and the endpoint were the same decision.
// Hosting moved off Lovable, so the endpoint is now derived from the model's
// vendor prefix and the keys that are actually configured:
//
//   google/*   → Google's Generative Language API   (GEMINI_API_KEY)
//   openai/*   → OpenAI                              (OPENAI_API_KEY)
//   runpod/*   → our own RunPod Serverless workers   (RUNPOD_API_KEY)
//   humain/*   → HUMAIN Node                         (HUMAIN_NODE_API_KEY)
//   everything → OpenRouter                          (OPENROUTER_API_KEY)
//
// Google and OpenAI both expose an OpenAI-shaped `/chat/completions`, which is
// the shape the whole codebase already speaks, so callers keep sending the same
// body they sent to Lovable. Only the URL, the auth header and the model id on
// the wire change.
//
// **OpenRouter is the safety net, not just a route.** It carries the same
// `vendor/model` id space the registry is written in, so when a vendor's own
// key is missing, or its API rejects the call outright, `chatFetch` retries the
// *same model* through OpenRouter once. That is a provider swap, never a model
// swap — the registry's "don't silently downgrade the model" rule still holds,
// and the retry is logged.
//
// Image generation is the one place the three providers disagree on shape, so
// it gets its own helper (`generateImage`) rather than a shared body.
// =============================================================================

import { IMAGE_MODEL_IDS, MODEL_IDS, reasoningFloor, type ReasoningEffort } from './modelRegistry.ts';

export type Provider = 'google' | 'openai' | 'openrouter' | 'fanar' | 'runpod' | 'humain';

// ---- Endpoints --------------------------------------------------------------
export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** Google's OpenAI-compatible surface. Same request/response shape as OpenRouter. */
export const GOOGLE_CHAT_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
export const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
export const GOOGLE_NATIVE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';
/** QCRI's Arabic-native model. OpenAI-shaped, but on nobody else's catalogue. */
export const FANAR_CHAT_URL = 'https://api.fanar.qa/v1/chat/completions';

/**
 * Is the self-hosted Jais rung switched on at all?
 *
 * **Off by default since 2026-09-18, and that is a cost decision with a
 * receipt.** The 8B endpoint billed $10.20 in its first twelve days, $10.02 of
 * it across three days (14–16 September) that produced barely any judged
 * output. The mechanism was not a bug in this file: every wake-up — the
 * run-start `warmArabicJudges()` ping, the tie-break warmer, a probe that found
 * the worker cold — starts a GPU worker that then bills until its *endpoint's*
 * idle timeout expires. That timeout was deployed at 1800s, not the 300s the
 * warm-up's own cost model assumes (see `warmArabicJudges` in
 * dialectValidator.ts), so each ping bought half an hour of GPU rather than
 * five minutes, and a day's scattered imports kept one worker up almost
 * continuously. At 8B this is the *weakest* Arabic judge on the roster, so the
 * spend bought the least valuable opinion in the pipeline.
 *
 * Nothing is deleted: the registry id, the endpoint mapping, the reasoning
 * floor, the validator ladder and every test around them stay exactly as they
 * were. This switch only decides whether the rung has an address, because
 * "no address" is the one Jais-shaped state the whole codebase already handles
 * and tests — the validator walks past it to Fanar, `warmArabicJudges()` finds
 * nothing self-hosted to ping, and the translation arbiter drops a rung with no
 * failed attempt in its provenance. Turning Jais back on is `JAIS_ENABLED=on`
 * plus the endpoint id, and nothing else.
 *
 * Before flipping it on, fix the economics first: drop the endpoint's idle
 * timeout to something near the 300s the warm-up assumes, or accept that a ping
 * costs a full idle window and warm deliberately rather than per run.
 */
function jaisEnabled(): boolean {
  return Deno.env.get('JAIS_ENABLED')?.trim().toLowerCase() === 'on';
}

/**
 * Jais 2 on our own RunPod Serverless worker.
 *
 * The one endpoint here whose URL is not a constant: it is a machine we
 * deployed, so its id *is* the address. Returns undefined when no endpoint is
 * configured, which is what keeps an un-deployed Jais an "unconfigured
 * provider" (a silent `unknown` at the validator) rather than a broken route.
 *
 * `RUNPOD_JAIS_BASE_URL` overrides the derived URL — that is the seam the edge
 * tests stub, and the escape hatch if the worker ever moves behind a proxy.
 *
 * `JAIS_ENABLED` gates all of it: off, this returns undefined however well the
 * endpoint is configured, so a secret left behind in a deployment cannot quietly
 * restart the meter. See `jaisEnabled`.
 */
export function runpodChatUrl(model: string): string | undefined {
  const suffix = RUNPOD_ENDPOINT_ENV[model];
  // A `runpod/` id nobody has given an address to. Unknown here rather than
  // guessed: falling back to another size's endpoint would answer as a
  // different model, which is the one thing the registry forbids.
  if (!suffix) return undefined;
  // Deliberately after the suffix check, so an unknown size stays unroutable
  // for its own reason rather than for this one.
  if (!jaisEnabled()) return undefined;
  const explicit = Deno.env.get(`RUNPOD_JAIS_${suffix}_BASE_URL`)?.trim();
  const id = Deno.env.get(`RUNPOD_JAIS_${suffix}_ENDPOINT_ID`)?.trim();
  const base = explicit || (id ? `https://${id}.api.runpod.ai` : '');
  return base ? `${base.replace(/\/+$/, '')}/v1/chat/completions` : undefined;
}

/**
 * HUMAIN Node's published API base. Includes the version segment, because that
 * is how Node documents it: every endpoint below is this plus a path, and
 * `/healthz` is deliberately the one that is not (it lives on the origin).
 */
export const HUMAIN_BASE_URL = 'https://api.node.humain.com/v1';

/**
 * HUMAIN Node's chat endpoint.
 *
 * A function rather than a constant only so `HUMAIN_BASE_URL` can be overridden
 * — the edge tests stub it there, and a tenant with its own gateway hostname
 * would too. Unlike the RunPod worker's URL this one has a real default, so M3
 * needs no address configured: a key is enough, exactly as Fanar is.
 */
export function humainChatUrl(): string {
  const base = Deno.env.get('HUMAIN_BASE_URL')?.trim() || HUMAIN_BASE_URL;
  return `${base.replace(/\/+$/, '')}/chat/completions`;
}

/**
 * Which endpoint serves which id. Each Jais size is its own deployment at its
 * own address with its own cost profile, so sizes cannot share an env var —
 * only the 8B is deployed today, and a second size is one entry here. Keyed by
 * the registry id rather than derived from it, so a typo is an unconfigured
 * model instead of a request to a URL that does not exist, and an id with no
 * entry is unroutable rather than answered by whichever worker is up.
 */
const RUNPOD_ENDPOINT_ENV: Record<string, string> = {
  [MODEL_IDS.JAIS2_8B]: '8B',
};

/** Vendors with no first-party account here — they only exist behind OpenRouter. */
const OPENROUTER_ONLY = /^(anthropic|qwen|meta-llama|mistralai|deepseek|x-ai|nousresearch|cohere)\//;

/**
 * Fanar ids carry no vendor prefix (`Fanar-C-2-27B`), so the family name is the
 * routing signal. Unlike every other vendor here, Fanar is not on OpenRouter —
 * see `canFallBack` for why that matters.
 */
const FANAR_MODEL = /^Fanar[-/]/i;

/**
 * `runpod/` is a routing signal, not a vendor namespace: it says "this model
 * lives on hardware we rent" rather than naming a catalogue. The worker serves
 * the model under the bare name, so the prefix is stripped on the wire.
 */
const RUNPOD_MODEL = /^runpod\//;

/**
 * HUMAIN's frontier Arabic model, on HUMAIN Node. An ordinary vendor prefix —
 * unlike `runpod/`, this one does name who publishes the model — stripped on
 * the wire because Node serves it under the bare name.
 */
const HUMAIN_MODEL = /^humain\//;

/**
 * Model ids whose Google-native name is not just the id minus its `google/`
 * prefix. Empty today — the prefix strip is right for every model the registry
 * names — but the exceptions are real often enough (dated snapshots, `-latest`
 * aliases) that the hook is worth keeping in one place rather than rediscovering
 * it inside a feature function.
 */
const GOOGLE_MODEL_ALIASES: Record<string, string> = {};

export class GatewayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayConfigError';
  }
}

// ---- Keys -------------------------------------------------------------------
// Read at call time, never at module scope: an edge function that imported this
// before its secrets were injected would otherwise cache `undefined` forever.

/** `GOOGLE_API_KEY` is accepted as an alias — the same key under Google's own name. */
export function googleApiKey(): string | undefined {
  return Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_API_KEY') ?? undefined;
}

export function openaiApiKey(): string | undefined {
  return Deno.env.get('OPENAI_API_KEY') ?? undefined;
}

export function openRouterApiKey(): string | undefined {
  return Deno.env.get('OPENROUTER_API_KEY') ?? undefined;
}

function keyFor(provider: Provider): string | undefined {
  switch (provider) {
    case 'google':
      return googleApiKey();
    case 'openai':
      return openaiApiKey();
    case 'openrouter':
      return openRouterApiKey();
    case 'fanar':
      return Deno.env.get('FANAR_API_KEY')?.trim() || undefined;
    case 'runpod':
      return Deno.env.get('RUNPOD_API_KEY')?.trim() || undefined;
    case 'humain':
      return Deno.env.get('HUMAIN_NODE_API_KEY')?.trim() || undefined;
  }
}

/**
 * True when at least one upstream is configured — the "can we call a model at
 * all" check, which `askBrain` runs as a preflight before it resolves a route.
 *
 * HUMAIN counts, and the reason is worth stating: this list is not "the
 * providers we like", it is "an upstream that could serve *some* model". Leave
 * a sole-provider vendor out and a deployment holding only its key fails here,
 * before the route that would have answered was ever built. Fanar and Jais are
 * absent for the opposite reason rather than a judgement — neither has ever
 * been the only key present, because both exist as extra legs beside a
 * configured Google or OpenRouter. M3 is the first model the pipeline can be
 * asked to run on its own.
 */
export function hasAnyProvider(): boolean {
  return Boolean(googleApiKey() ?? openaiApiKey() ?? openRouterApiKey() ?? keyFor('humain'));
}

// ---- Routing ----------------------------------------------------------------

/** The vendor a model id names, before the configured-keys question is asked. */
export function vendorForModel(model: string): Provider {
  if (FANAR_MODEL.test(model)) return 'fanar';
  if (RUNPOD_MODEL.test(model)) return 'runpod';
  if (HUMAIN_MODEL.test(model)) return 'humain';
  if (OPENROUTER_ONLY.test(model)) return 'openrouter';
  if (/^google\//.test(model)) return 'google';
  if (/^openai\//.test(model)) return 'openai';
  return 'openrouter';
}

/**
 * Whether a vendor's traffic can be rescued by OpenRouter.
 *
 * Only true for vendors whose models OpenRouter actually lists. Two vendors
 * make this a function rather than a `!== 'openrouter'` check, for the same
 * reason: Fanar is a sovereign model on QCRI's own endpoint, and Jais 2 runs on
 * a worker we rent. Neither is on OpenRouter's catalogue, so retrying either
 * there would turn one real failure into a 404 about a model that was never
 * present.
 */
function canFallBack(provider: Provider): boolean {
  return provider === 'google' || provider === 'openai';
}

/**
 * The provider that will actually be called: the model's vendor when its key is
 * configured, OpenRouter otherwise. Deterministic and side-effect free, so a
 * caller can log or branch on it without making a request.
 */
export function providerForModel(model: string): Provider {
  const vendor = vendorForModel(model);
  if (canFallBack(vendor) && !keyFor(vendor) && openRouterApiKey()) return 'openrouter';
  return vendor;
}

/** The id to put on the wire. OpenRouter keeps the `vendor/model` form; the vendors' own APIs don't use it. */
export function upstreamModelId(model: string, provider: Provider): string {
  if (provider === 'openrouter') return model;
  if (provider === 'google') return GOOGLE_MODEL_ALIASES[model] ?? model.replace(/^google\//, '');
  if (provider === 'fanar') return model;
  // The worker is started with `--served-model-name`, which is the id minus
  // this prefix — vLLM 404s on a name it was not given.
  if (provider === 'runpod') return model.replace(/^runpod\//, '');
  if (provider === 'humain') return humainServedId(model.replace(/^humain\//, ''));
  return model.replace(/^openai\//, '');
}

// ---- HUMAIN Node's per-key catalogue ----------------------------------------
//
// Node's catalogue is *per key*: which ids a key may call is assigned per
// account across its access tiers, and M3 in particular is gated behind an
// approval. The docs name the model `humain-m3`, and that is what the registry
// carries — but the first live run answered every call with
// `400 Unsupported model: humain-m3`, which is what Node says when the id is
// not in *this key's* catalogue, whether because access is still pending or
// because the served name differs on this tier. Nothing here can know which
// from the error alone, so the gateway asks: `GET /v1/models` with the same
// key, then retries once under whatever id there looks like M3. When nothing
// there does, the refusal stands and the log names the catalogue, which is the
// one sentence that turns "M3 didn't fire" into "request access on Node".

/** Operator override: the id Node serves M3 under for this key, when known. */
function humainServedId(bare: string): string {
  const override = Deno.env.get('HUMAIN_M3_MODEL_ID')?.trim();
  if (override && bare === MODEL_IDS.HUMAIN_M3.replace(/^humain\//, '')) return override;
  return humainAliases.get(bare) ?? bare;
}

/** Requested bare id → the id this key's catalogue actually serves it as. Per isolate. */
const humainAliases = new Map<string, string>();
/** A catalogue row: the id, plus whatever Node says about how it is called. */
interface HumainCatalogueRow {
  id: string;
  /** Node's `node.api_interface`, e.g. "chat", "embeddings" — absent on a bare list. */
  apiInterface?: string;
}

/** The last catalogue fetched, for the log line and the judge's attempt record. */
let humainCatalogue: HumainCatalogueRow[] | null = null;

/** Node refusing the *model* — as opposed to the request, the key, or the service. */
export function isHumainModelRejection(status: number, body: string): boolean {
  if (status !== 400 && status !== 404) return false;
  return /unsupported model|model_not_found|model not found|unknown model|no such model/i.test(body);
}

/**
 * What this key may call on Node, or null when the catalogue could not be
 * read. One request per isolate: availability changes on Node's side, not
 * between two calls of ours.
 */
export async function humainCatalogueIds(signal?: AbortSignal): Promise<string[] | null> {
  const rows = await humainCatalogueRows(signal);
  return rows ? rows.map((row) => row.id) : null;
}

async function humainCatalogueRows(signal?: AbortSignal): Promise<HumainCatalogueRow[] | null> {
  if (humainCatalogue) return humainCatalogue;
  const apiKey = keyFor('humain');
  if (!apiKey) return null;
  const base = Deno.env.get('HUMAIN_BASE_URL')?.trim() || HUMAIN_BASE_URL;
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!res.ok) {
      console.warn(`[aiGateway] HUMAIN Node catalogue: HTTP ${res.status}`);
      return null;
    }
    type Row = { id?: unknown; node?: { api_interface?: unknown } };
    const data = await res.json() as { data?: Row[] } | Row[];
    const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    humainCatalogue = rows.flatMap((row): HumainCatalogueRow[] => {
      if (typeof row?.id !== 'string' || !row.id) return [];
      const apiInterface = row.node?.api_interface;
      return [{ id: row.id, ...(typeof apiInterface === 'string' ? { apiInterface } : {}) }];
    });
    return humainCatalogue;
  } catch (err) {
    console.warn('[aiGateway] HUMAIN Node catalogue unreadable:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * One line on what this key can call — for the record a consumer keeps of a
 * rung that refused, so the row answers the question rather than the log.
 * Null until a refusal has made the gateway look.
 */
export function humainCatalogueSummary(): string | null {
  if (!humainCatalogue) return null;
  if (humainCatalogue.length === 0) return "this key's HUMAIN Node catalogue is empty";
  return `this key's HUMAIN Node catalogue: ${humainCatalogue.map((row) => row.id).join(', ')}`;
}

/**
 * Ids that are the same family but a different *kind* of model. "m3" is not
 * a name HUMAIN owns — BGE-M3 is an embedding model that could plausibly sit
 * in the same catalogue — so a chat alias must never resolve to one of these.
 */
const NON_CHAT_ID = /embed|rerank|encoder|bge|tts|stt|whisper|asr|ocr|vision-only/i;

/**
 * The id this key's catalogue serves `bare` under, or null when nothing there
 * is the same model.
 *
 * An exact match wins. Failing that, a tier may publish M3 under a suffixed
 * id, so the family name is matched — but only on HUMAIN's own ids (the
 * catalogue is shared with third-party models) and only on rows that are, as
 * far as Node says or the id suggests, chat models. A wrong guess here is
 * worse than none: the retry fails and, were it remembered, every later call
 * would start from the wrong id.
 */
async function discoverHumainId(bare: string, signal?: AbortSignal): Promise<string | null> {
  const rows = await humainCatalogueRows(signal);
  if (!rows) return null;
  if (rows.some((row) => row.id === bare)) return bare;
  const family = bare.replace(/^humain-/, '').split(/[-_]/)[0];
  if (!family) return null;
  const pattern = new RegExp(`(^|[-_/])${family}([-_/]|$)`, 'i');
  const candidate = rows.find((row) =>
    /humain/i.test(row.id) &&
    pattern.test(row.id) &&
    !NON_CHAT_ID.test(row.id) &&
    (!row.apiInterface || /chat|completions|messages|responses/i.test(row.apiInterface))
  );
  return candidate?.id ?? null;
}

export interface ChatRoute {
  provider: Provider;
  url: string;
  /** The model id as the chosen provider expects it. */
  model: string;
  headers: Record<string, string>;
}

const CHAT_URLS: Record<Exclude<Provider, 'runpod' | 'humain'>, string> = {
  google: GOOGLE_CHAT_URL,
  openai: OPENAI_CHAT_URL,
  openrouter: OPENROUTER_CHAT_URL,
  fanar: FANAR_CHAT_URL,
};

/**
 * Most providers have a fixed URL. The two we address by configuration rather
 * than by catalogue — our own RunPod worker and HUMAIN Node — are resolved per
 * call and can legitimately be absent.
 */
function chatUrlFor(model: string, provider: Provider): string | undefined {
  if (provider === 'runpod') return runpodChatUrl(model);
  if (provider === 'humain') return humainChatUrl();
  return CHAT_URLS[provider];
}

const KEY_ENV: Record<Provider, string> = {
  google: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  fanar: 'FANAR_API_KEY',
  runpod: 'RUNPOD_API_KEY',
  humain: 'HUMAIN_NODE_API_KEY',
};

/** Resolve a model to a concrete endpoint, or `null` when nothing is configured to serve it. */
export function tryChatRoute(model: string, provider = providerForModel(model)): ChatRoute | null {
  const apiKey = keyFor(provider);
  if (!apiKey) return null;
  const url = chatUrlFor(model, provider);
  // A key with nowhere to send it is as unconfigured as no key at all.
  if (!url) return null;
  return {
    provider,
    url,
    model: upstreamModelId(model, provider),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };
}

/** Same as `tryChatRoute`, but throws a message that names the missing secret. */
export function chatRoute(model: string, provider = providerForModel(model)): ChatRoute {
  const route = tryChatRoute(model, provider);
  if (!route) {
    // RunPod can fail this three ways — no key, no endpoint id, or the whole
    // rung switched off — and naming the key when one of the others is what is
    // missing sends the reader to the wrong secret. HUMAIN cannot: its base has
    // a default, so a missing key is the only way it gets here.
    const missing = provider === 'runpod' && keyFor(provider)
      ? (jaisEnabled()
        ? `RUNPOD_JAIS_${RUNPOD_ENDPOINT_ENV[model] ?? '<size>'}_ENDPOINT_ID`
        : 'JAIS_ENABLED')
      : KEY_ENV[provider];
    throw new GatewayConfigError(
      `${missing} not configured (required for ${model})`,
    );
  }
  return route;
}

// ---- Calling ----------------------------------------------------------------

/**
 * Statuses worth re-trying on a different provider.
 *
 * 429 is deliberately absent: a rate limit is a real signal several callers
 * surface to the learner ("slow down"), and quietly spending a second provider's
 * quota to paper over it hides the cap rather than respecting it.
 */
const FALLBACK_STATUSES = new Set([400, 401, 403, 404, 408, 500, 502, 503, 504]);

/**
 * How much a model may think before it answers.
 *
 *   'off'            the least the model allows (see `reasoningFloor`) — the default
 *   'model-default'  send nothing and take the provider's default
 *   { effort }       ask for a specific level
 */
export type ReasoningPreference = 'off' | 'model-default' | { effort: ReasoningEffort };

export interface ChatFetchOptions {
  signal?: AbortSignal;
  /** Extra headers merged over the route's own (auth and content-type). */
  headers?: Record<string, string>;
  /** Skip the OpenRouter retry — for callers that already run their own model ladder. */
  noFallback?: boolean;
  /** Prefix for the console warning a fallback emits. Defaults to the model id. */
  label?: string;
  /**
   * Whether the model may think first. Off unless asked: the lineup's models
   * reason by default at their providers (Sonnet 5 "high", Qwen 3.8 Max
   * "xhigh"), which turned every pipeline call into a minutes-long one and
   * spent the output budget on thinking. A body that already carries a
   * `reasoning` or `reasoning_effort` field is left exactly as written.
   */
  reasoning?: ReasoningPreference;
}

/**
 * The reasoning field a provider understands, or nothing.
 *
 * OpenRouter takes a `reasoning` object; Google's and OpenAI's OpenAI-shaped
 * endpoints take `reasoning_effort`. Google cannot switch Gemini 3.x off, so a
 * request for "none" is sent to it as "low" — the least it accepts — rather
 * than rejected. Fanar has no such switch.
 */
function reasoningFieldFor(
  provider: Provider,
  effort: ReasoningEffort,
): Record<string, unknown> | null {
  // Fanar has no such switch, and Jais 2 is not a reasoning model — plain vLLM
  // rejects an effort field it has no sampler for. Node's /chat/completions
  // documents the fields it accepts and neither spelling is among them, so M3
  // is sent none either; its own `max_tokens` and `temperature` are there,
  // which is everything the Brain's bodies actually set.
  if (provider === 'fanar' || provider === 'runpod' || provider === 'humain') return null;
  if (provider === 'openrouter') return { reasoning: { effort } };
  if (provider === 'google') return { reasoning_effort: effort === 'none' ? 'low' : effort };
  return { reasoning_effort: effort };
}

/**
 * `body` with the reasoning default applied for `provider`, and whether
 * anything was added — a body the caller already shaped is returned as is.
 */
export function withReasoningDefault(
  body: Record<string, unknown>,
  model: string,
  provider: Provider,
  preference: ReasoningPreference = 'off',
): { body: Record<string, unknown>; injected: boolean } {
  if (preference === 'model-default') return { body, injected: false };
  if ('reasoning' in body || 'reasoning_effort' in body) return { body, injected: false };
  const effort = typeof preference === 'object' ? preference.effort : reasoningFloor(model);
  const field = reasoningFieldFor(provider, effort);
  if (!field) return { body, injected: false };
  return { body: { ...body, ...field }, injected: true };
}

export interface ChatFetchResult {
  response: Response;
  /** The provider that produced `response` — what cost telemetry should record. */
  provider: Provider;
  /** The model id as sent to `provider`. */
  model: string;
  /** Set when the first-choice provider failed and OpenRouter answered instead. */
  fellBackFrom?: Provider;
}

/**
 * POST an OpenAI-shaped chat body to whichever provider serves `model`.
 *
 * `body.model` is overwritten with the id that provider expects, so callers
 * pass the registry id and never think about the translation. The response is
 * returned unread — every caller has its own idea of what a failure means.
 */
export async function chatFetchDetailed(
  model: string,
  body: Record<string, unknown>,
  options: ChatFetchOptions = {},
): Promise<ChatFetchResult> {
  const primary = providerForModel(model);
  const route = chatRoute(model, primary);
  const label = options.label ?? model;

  // The reasoning default is shaped per route, because the provider that ends
  // up answering may not be the one asked first, and the two spell it
  // differently. `plain` sends the caller's body untouched.
  const send = async (r: ChatRoute, plain = false): Promise<Response> => {
    const shaped = plain ? body : withReasoningDefault(body, model, r.provider, options.reasoning).body;
    return await fetch(r.url, {
      method: 'POST',
      headers: { ...r.headers, ...(options.headers ?? {}) },
      body: JSON.stringify({ ...shaped, model: r.model }),
      signal: options.signal,
    });
  };

  const fallbackRoute = (): ChatRoute | null => {
    if (options.noFallback || !canFallBack(primary)) return null;
    return tryChatRoute(model, 'openrouter');
  };

  let response: Response;
  try {
    response = await send(route);
    // A 400 to a request we added a reasoning field to may be that field: an
    // effort the model does not support is rejected as a bad request, and the
    // floor table is a best reading of each model's metadata, not a contract.
    // One plain retry costs a round trip; a wrong guess left standing would
    // cost the whole call, on every call, for that model.
    if (
      response.status === 400 &&
      withReasoningDefault(body, model, route.provider, options.reasoning).injected
    ) {
      const detail = await response.clone().text().catch(() => '');
      console.warn(
        `[aiGateway] ${label}: ${route.provider} answered 400 with the reasoning default ` +
          `(${detail.slice(0, 200)}) — retrying without it`,
      );
      response = await send(route, true);
    }
    // Node refusing the *model* is a catalogue question, not an outage. Ask
    // what this key may call, retry once under the id that is M3 there, and
    // remember the answer so the next call goes straight to it. When the
    // catalogue has no M3 at all the refusal stands — access has not been
    // granted on this key — and the log says exactly that.
    if (route.provider === 'humain' && !response.ok) {
      const detail = await response.clone().text().catch(() => '');
      if (isHumainModelRejection(response.status, detail)) {
        const served = await discoverHumainId(route.model, options.signal);
        if (served && served !== route.model) {
          console.warn(
            `[aiGateway] ${label}: HUMAIN Node refused "${route.model}" (${detail.slice(0, 120)}); ` +
              `this key serves it as "${served}" — retrying under that id`,
          );
          const retried = await send({ ...route, model: served });
          // Remembered only once it has answered: an alias cached on a guess
          // would put every later call behind the same wrong id.
          if (retried.ok) humainAliases.set(route.model, served);
          return { response: retried, provider: route.provider, model: served };
        }
        console.warn(
          `[aiGateway] ${label}: HUMAIN Node refused "${route.model}" (${detail.slice(0, 120)}) and ` +
            `${humainCatalogueSummary() ?? 'its catalogue could not be read'}` +
            (humainCatalogue ? ' — M3 access is not granted on this key' : ''),
        );
      }
    }
  } catch (err) {
    // A transport-level failure (DNS, TLS, connection reset) is exactly what the
    // second provider exists for. An abort is not — the caller asked to stop.
    const aborted = options.signal?.aborted || (err as { name?: string })?.name === 'AbortError';
    const alt = aborted ? null : fallbackRoute();
    if (!alt) throw err;
    console.warn(`[aiGateway] ${label}: ${primary} unreachable, retrying on openrouter`);
    return { response: await send(alt), provider: 'openrouter', model: alt.model, fellBackFrom: primary };
  }

  if (!response.ok && FALLBACK_STATUSES.has(response.status)) {
    const alt = fallbackRoute();
    if (alt) {
      const detail = await response.clone().text().catch(() => '');
      console.warn(
        `[aiGateway] ${label}: ${primary} ${response.status} ${detail.slice(0, 200)} — retrying on openrouter`,
      );
      // The retry's response is what the caller sees either way: when it worked
      // that is the point, and when it failed too the second failure is the one
      // that describes the state the request actually ended in.
      const retried = await send(alt);
      return { response: retried, provider: 'openrouter', model: alt.model, fellBackFrom: primary };
    }
  }

  return { response, provider: route.provider, model: route.model };
}

/** `chatFetchDetailed` for callers that only want the Response. */
export async function chatFetch(
  model: string,
  body: Record<string, unknown>,
  options: ChatFetchOptions = {},
): Promise<Response> {
  return (await chatFetchDetailed(model, body, options)).response;
}

/**
 * Nudge a self-hosted worker awake, without waiting for it to come up.
 *
 * A no-op for every provider but `runpod`: everyone else here is somebody
 * else's always-on API, where there is nothing to warm and a wake-up request
 * would just be a billed call with its answer thrown away.
 *
 * This is a fire-and-forget sink in the same sense as the four loggers — it
 * swallows its own errors, returns nothing, and can never fail the request it
 * was attached to. Returning a promise would invite an `await` at a call site,
 * and a warm-up somebody waits for is just a slow request by another name.
 *
 * The timeout is deliberately generous rather than short. Aborting does not
 * stop a boot that has already started, but a wake-up that hangs up early
 * cannot tell us it worked, and `waitUntil` is what keeps the isolate alive
 * long enough for it to finish at all.
 */
export function warmRoute(model: string, timeoutMs = 300_000): void {
  const route = tryChatRoute(model);
  if (!route || route.provider !== 'runpod') return;

  const task = fetch(route.url, {
    method: 'POST',
    headers: route.headers,
    // The smallest legal completion: this call exists for its side effect on
    // the worker, so a single token is as much answer as it needs.
    body: JSON.stringify({
      model: route.model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
    // Draining the body is what lets the connection be reused rather than left
    // hanging on an isolate that is about to be torn down.
    .then((res) => res.body?.cancel())
    .catch(() => {});

  // The Supabase edge runtime tears an isolate down once the handler resolves,
  // which would kill a boot that takes minutes. `waitUntil` is how the four
  // background-work functions here keep theirs alive; outside that runtime
  // (deno test, local dev) the bare promise is the fallback.
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil?: (task: Promise<unknown>) => void };
  }).EdgeRuntime;
  runtime?.waitUntil?.(task);
}

/**
 * The assistant text of an OpenAI-shaped completion, or null when there wasn't one.
 *
 * `content` is a string on most providers and an array of typed parts on the
 * multimodal ones — HUMAIN M3 is natively multimodal, and the first run that
 * reached it under its served id came back "empty" to a caller that only read
 * strings. Text parts are joined; anything else (images, tool parts) is not
 * text and is left out.
 */
export function completionText(data: unknown): string | null {
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim() ? content : null;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === 'string') return part;
        const p = part as { type?: unknown; text?: unknown; content?: unknown } | null;
        if (p && typeof p.text === 'string' && (p.type === undefined || /text/i.test(String(p.type)))) return p.text;
        if (p && typeof p.content === 'string') return p.content;
        return '';
      })
      .join('');
    return text.trim() ? text : null;
  }
  return null;
}

/**
 * Why a 200 carried no text — for the record a caller keeps of a rung that
 * answered nothing. Names the finish reason, a refusal if the provider set
 * one, and the keys the message did carry, so "empty response body" on a row
 * says whether it was a guardrail, a length cut, or a shape this code does not
 * read yet.
 */
export function describeEmptyCompletion(data: unknown): string {
  const d = data as {
    choices?: Array<{ finish_reason?: unknown; message?: Record<string, unknown> | null }>;
    error?: unknown;
  } | null;
  const choice = d?.choices?.[0];
  if (!choice) {
    const keys = d && typeof d === 'object' ? Object.keys(d).join(', ') : typeof d;
    return `no choices in response (top-level keys: ${keys || 'none'})`;
  }
  const bits: string[] = [];
  if (choice.finish_reason !== undefined) bits.push(`finish_reason=${String(choice.finish_reason)}`);
  const message = choice.message ?? {};
  const refusal = message.refusal;
  if (typeof refusal === 'string' && refusal.trim()) bits.push(`refusal="${refusal.slice(0, 80)}"`);
  const content = message.content;
  bits.push(
    content === undefined ? 'no content field'
      : content === null ? 'content=null'
      : Array.isArray(content) ? `content is an array of ${content.length} part(s) with no text`
      : typeof content === 'string' ? 'content is an empty string'
      : `content is ${typeof content}`,
  );
  const keys = Object.keys(message).filter((k) => k !== 'content' && k !== 'role');
  if (keys.length) bits.push(`other message keys: ${keys.join(', ')}`);
  return bits.join('; ');
}

// ---- Image generation -------------------------------------------------------
//
// The one call shape that did not survive the move. Lovable exposed image models
// through both `/v1/images/generations` (with `messages`) and chat completions
// with `modalities`. Neither vendor accepts that hybrid, so the shape is chosen
// per provider here and the callers just ask for bytes.

export interface GeneratedImage {
  bytes: Uint8Array;
  contentType: string;
  provider: Provider;
  model: string;
}

export interface GenerateImageOptions {
  /** Registry id of the image model to try first. Defaults to the Gemini image model. */
  model?: string;
  /** Square size hint, used only by the OpenAI fallback. */
  size?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  label?: string;
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Split a `data:` URL into its bytes and content type. Throws on anything else. */
export function decodeImageDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('expected a base64 data URL');
  return { bytes: decodeBase64(m[2]), contentType: m[1] || 'image/png' };
}

/** The file extension for an image content type, for storage keys. */
export function imageExtension(contentType: string): string {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  return 'png';
}

async function googleImage(
  prompt: string,
  model: string,
  signal: AbortSignal | undefined,
): Promise<GeneratedImage | null> {
  const key = googleApiKey();
  if (!key) return null;
  const id = upstreamModelId(model, 'google');
  const resp = await fetch(`${GOOGLE_NATIVE_URL}/${id}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
    signal,
  });
  if (!resp.ok) {
    console.warn(`[aiGateway] google image ${id} ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`);
    return null;
  }
  const data = await resp.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part?.inlineData ?? part?.inline_data;
    if (inline?.data) {
      return {
        bytes: decodeBase64(inline.data),
        contentType: inline.mimeType ?? inline.mime_type ?? 'image/png',
        provider: 'google',
        model: id,
      };
    }
  }
  return null;
}

async function openaiImage(
  prompt: string,
  size: string,
  signal: AbortSignal | undefined,
): Promise<GeneratedImage | null> {
  const key = openaiApiKey();
  if (!key) return null;
  const id = upstreamModelId(IMAGE_MODEL_IDS.OPENAI, 'openai');
  const resp = await fetch(OPENAI_IMAGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: id, prompt, size, n: 1 }),
    signal,
  });
  if (!resp.ok) {
    console.warn(`[aiGateway] openai image ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`);
    return null;
  }
  const data = await resp.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) return null;
  return { bytes: decodeBase64(b64), contentType: 'image/png', provider: 'openai', model: id };
}

async function openRouterImage(
  prompt: string,
  model: string,
  signal: AbortSignal | undefined,
): Promise<GeneratedImage | null> {
  const route = tryChatRoute(model, 'openrouter');
  if (!route) return null;
  const resp = await fetch(route.url, {
    method: 'POST',
    headers: route.headers,
    body: JSON.stringify({
      model: route.model,
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image', 'text'],
    }),
    signal,
  });
  if (!resp.ok) {
    console.warn(`[aiGateway] openrouter image ${route.model} ${resp.status}`);
    return null;
  }
  const data = await resp.json();
  const url: string | undefined = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) return null;
  const { bytes, contentType } = decodeImageDataUrl(url);
  return { bytes, contentType, provider: 'openrouter', model: route.model };
}

/**
 * Generate one image, trying each configured provider in turn.
 *
 * Order is Google (the model the art direction was tuned on), then OpenAI's
 * image model, then the same Gemini model through OpenRouter. Returns null only
 * when every configured provider declined — callers decide whether that is fatal.
 */
export async function generateImage(
  prompt: string,
  options: GenerateImageOptions = {},
): Promise<GeneratedImage | null> {
  const model = options.model ?? IMAGE_MODEL_IDS.GEMINI;
  const signal = options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 90_000);
  const label = options.label ?? 'image';

  const attempts: Array<() => Promise<GeneratedImage | null>> = [
    () => googleImage(prompt, model, signal),
    () => openaiImage(prompt, options.size ?? '1024x1024', signal),
    () => openRouterImage(prompt, model, signal),
  ];

  for (const attempt of attempts) {
    try {
      const image = await attempt();
      if (image) return image;
    } catch (err) {
      if (signal.aborted) throw err;
      console.warn(`[aiGateway] ${label}: image attempt failed:`, err instanceof Error ? err.message : String(err));
    }
  }
  return null;
}

/** `generateImage`, returned as a `data:` URL for callers that pass one to storage or the client. */
export async function generateImageDataUrl(
  prompt: string,
  options: GenerateImageOptions = {},
): Promise<string | null> {
  const image = await generateImage(prompt, options);
  if (!image) return null;
  let binary = '';
  for (const byte of image.bytes) binary += String.fromCharCode(byte);
  return `data:${image.contentType};base64,${btoa(binary)}`;
}
