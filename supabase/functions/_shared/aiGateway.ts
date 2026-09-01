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

import { IMAGE_MODEL_IDS } from './modelRegistry.ts';

export type Provider = 'google' | 'openai' | 'openrouter' | 'fanar';

// ---- Endpoints --------------------------------------------------------------
export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** Google's OpenAI-compatible surface. Same request/response shape as OpenRouter. */
export const GOOGLE_CHAT_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
export const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
export const GOOGLE_NATIVE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';
/** QCRI's Arabic-native model. OpenAI-shaped, but on nobody else's catalogue. */
export const FANAR_CHAT_URL = 'https://api.fanar.qa/v1/chat/completions';

/** Vendors with no first-party account here — they only exist behind OpenRouter. */
const OPENROUTER_ONLY = /^(anthropic|qwen|meta-llama|mistralai|deepseek|x-ai|nousresearch|cohere)\//;

/**
 * Fanar ids carry no vendor prefix (`Fanar-C-2-27B`), so the family name is the
 * routing signal. Unlike every other vendor here, Fanar is not on OpenRouter —
 * see `canFallBack` for why that matters.
 */
const FANAR_MODEL = /^Fanar[-/]/i;

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
  }
}

/** True when at least one upstream is configured — the "can we call a model at all" check. */
export function hasAnyProvider(): boolean {
  return Boolean(googleApiKey() ?? openaiApiKey() ?? openRouterApiKey());
}

// ---- Routing ----------------------------------------------------------------

/** The vendor a model id names, before the configured-keys question is asked. */
export function vendorForModel(model: string): Provider {
  if (FANAR_MODEL.test(model)) return 'fanar';
  if (OPENROUTER_ONLY.test(model)) return 'openrouter';
  if (/^google\//.test(model)) return 'google';
  if (/^openai\//.test(model)) return 'openai';
  return 'openrouter';
}

/**
 * Whether a vendor's traffic can be rescued by OpenRouter.
 *
 * Only true for vendors whose models OpenRouter actually lists. Fanar is the
 * exception that makes this a function rather than a `!== 'openrouter'` check:
 * it is a sovereign model on QCRI's own endpoint, so retrying `Fanar-C-2-27B`
 * against OpenRouter would turn one real failure into a 404 about a model that
 * was never there.
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
  return model.replace(/^openai\//, '');
}

export interface ChatRoute {
  provider: Provider;
  url: string;
  /** The model id as the chosen provider expects it. */
  model: string;
  headers: Record<string, string>;
}

const CHAT_URLS: Record<Provider, string> = {
  google: GOOGLE_CHAT_URL,
  openai: OPENAI_CHAT_URL,
  openrouter: OPENROUTER_CHAT_URL,
  fanar: FANAR_CHAT_URL,
};

const KEY_ENV: Record<Provider, string> = {
  google: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  fanar: 'FANAR_API_KEY',
};

/** Resolve a model to a concrete endpoint, or `null` when nothing is configured to serve it. */
export function tryChatRoute(model: string, provider = providerForModel(model)): ChatRoute | null {
  const apiKey = keyFor(provider);
  if (!apiKey) return null;
  return {
    provider,
    url: CHAT_URLS[provider],
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
    throw new GatewayConfigError(
      `${KEY_ENV[provider]} not configured (required for ${model})`,
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

export interface ChatFetchOptions {
  signal?: AbortSignal;
  /** Extra headers merged over the route's own (auth and content-type). */
  headers?: Record<string, string>;
  /** Skip the OpenRouter retry — for callers that already run their own model ladder. */
  noFallback?: boolean;
  /** Prefix for the console warning a fallback emits. Defaults to the model id. */
  label?: string;
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

  const send = async (r: ChatRoute): Promise<Response> =>
    await fetch(r.url, {
      method: 'POST',
      headers: { ...r.headers, ...(options.headers ?? {}) },
      body: JSON.stringify({ ...body, model: r.model }),
      signal: options.signal,
    });

  const fallbackRoute = (): ChatRoute | null => {
    if (options.noFallback || !canFallBack(primary)) return null;
    return tryChatRoute(model, 'openrouter');
  };

  let response: Response;
  try {
    response = await send(route);
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

/** The assistant text of an OpenAI-shaped completion, or null when there wasn't one. */
export function completionText(data: unknown): string | null {
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content;
  return typeof content === 'string' && content.trim() ? content : null;
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
