// Secrets, voice discovery and provider IO for text-to-speech.
//
// The decision itself lives in `ttsVoiceRoutingCore.ts`, which is pure so the
// Vitest suite can drive it against fixtures. This half is everything that
// half cannot touch: `Deno.env`, Munsit's catalogue, and the three HTTP calls
// that actually make audio.
//
// Direction of dependency is one-way — `listenTts.ts` imports from here, never
// the reverse — so the synthesizers live here rather than there.

import {
  type AppDialect,
  type MunsitVoice,
  planVoices,
  type TtsProvider,
  type VoiceConfig,
  type VoicePlan,
  ELEVENLABS_EGYPTIAN_VOICE_IDS,
  normalizeDialect,
  pickVoiceSlot,
} from "./ttsVoiceRoutingCore.ts";

const MUNSIT_BASE = "https://api.munsit.com/api/v1";

const DIALECTS: AppDialect[] = ["Gulf", "Egyptian", "Yemeni", "MSA"];

/**
 * Voice IDs have no guaranteed format.
 *
 * Munsit's docs are explicit about this: most of the catalogue looks like
 * `PCtWbxjoNTpVQ6gIPaVZ2Hqm`, some like `ar-najdi-male-2`, and cloned voices
 * like `cl-layla-8f21`. So this validates *shape only* — enough to reject a
 * pasted sentence, a URL or an injected header, and nothing more. Anything
 * stricter would silently drop a legitimate ID.
 */
const VOICE_ID_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

/**
 * Parses a comma-separated secret into voice IDs.
 *
 * Comma-separated and not whitespace-separated, because splitting on whitespace
 * quietly turns prose into voice IDs: "not a voice id" would yield four tokens,
 * two of which pass a shape check. A stray sentence should be rejected loudly,
 * so the whole value has to be one well-formed ID or a comma-separated list of
 * them.
 *
 * A malformed secret degrades to "not configured" rather than to an open list,
 * and says so in the log — a typo that silently disabled the cloned voice would
 * otherwise look identical to never having set it.
 */
export function parseVoiceIds(raw: string | undefined | null, max = 4): string[] {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return [];

  const candidates = trimmed.split(",").map((part) => part.trim()).filter(Boolean);
  const valid = candidates.filter((id) => VOICE_ID_PATTERN.test(id));

  if (valid.length < candidates.length) {
    console.warn(
      `ttsVoiceRouting: dropped ${candidates.length - valid.length} malformed voice id(s); ` +
        `expected ${VOICE_ID_PATTERN} — check the secret for quotes or stray characters`,
    );
  }
  return valid.slice(0, max);
}

function providerOverrideFor(dialect: AppDialect): TtsProvider | "auto" {
  const raw = Deno.env.get(`TTS_PROVIDER_${dialect.toUpperCase()}`)?.trim().toLowerCase();
  if (raw === "munsit" || raw === "azure" || raw === "elevenlabs") return raw;
  if (raw && raw !== "auto") {
    console.warn(`ttsVoiceRouting: ignoring unknown TTS_PROVIDER_${dialect.toUpperCase()}="${raw}"`);
  }
  return "auto";
}

function pinnedFor(dialect: AppDialect): string[] {
  const pinned = parseVoiceIds(Deno.env.get(`MUNSIT_${dialect.toUpperCase()}_VOICE_IDS`));
  if (pinned.length > 0) return pinned;
  // The pre-existing single-value secret, still honoured so an existing
  // deployment's Gulf pin keeps working without being renamed.
  if (dialect === "Gulf") return parseVoiceIds(Deno.env.get("MUNSIT_GULF_VOICE_ID"), 1);
  return [];
}

// ── Munsit catalogue discovery ───────────────────────────────────────────────

interface MunsitCatalogue {
  voices: MunsitVoice[];
  modelId: string | null;
}

let cached: MunsitCatalogue | null = null;
let inFlight: Promise<MunsitCatalogue> | null = null;

async function pickModelId(apiKey: string): Promise<string | null> {
  const override = Deno.env.get("MUNSIT_TTS_MODEL_ID")?.trim();
  if (override) return override;
  try {
    const resp = await fetch(`${MUNSIT_BASE}/models`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;
    const models = await resp.json() as Array<{ model_id: string; model_name?: string }>;
    if (!Array.isArray(models) || models.length === 0) return null;
    // Faseeh is the current model and matches /v1/; `mini` is preferred where it
    // exists because single-word playback is latency-sensitive.
    const mini = models.find((m) => /mini/i.test(m.model_id));
    const v1 = models.find((m) => /v1/i.test(m.model_id));
    return (mini ?? v1 ?? models[0]).model_id;
  } catch (err) {
    console.warn("ttsVoiceRouting: /models fetch failed:", err);
    return null;
  }
}

async function fetchCatalogue(apiKey: string): Promise<MunsitCatalogue> {
  const [voicesResp, modelId] = await Promise.all([
    fetch(`${MUNSIT_BASE}/voices`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    }).catch((err) => {
      console.warn("ttsVoiceRouting: /voices fetch failed:", err);
      return null;
    }),
    pickModelId(apiKey),
  ]);

  if (!voicesResp || !voicesResp.ok) {
    console.warn(`ttsVoiceRouting: /voices ${voicesResp?.status ?? "no-response"}`);
    return { voices: [], modelId };
  }

  const voices = await voicesResp.json().catch(() => null) as MunsitVoice[] | null;
  if (!Array.isArray(voices)) return { voices: [], modelId };

  console.log(
    `ttsVoiceRouting: ${voices.length} Munsit voices (model=${modelId}); ` +
      `dialects=${[...new Set(voices.flatMap((v) => v.dialect ?? []))].sort().join(",") || "none"}`,
  );
  return { voices, modelId };
}

/**
 * The catalogue, fetched once per isolate.
 *
 * Only a successful fetch is cached: a transient `/voices` outage would
 * otherwise pin an empty catalogue for the isolate's whole life, quietly
 * demoting every dialect to Azure until the next cold start.
 */
async function loadCatalogue(apiKey: string): Promise<MunsitCatalogue> {
  if (cached) return cached;
  if (!inFlight) {
    inFlight = fetchCatalogue(apiKey).then((result) => {
      if (result.voices.length > 0 && result.modelId) cached = result;
      return result;
    }).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Drops the memoised catalogue. Tests use this; nothing in production does. */
export function resetCatalogueCache(): void {
  cached = null;
  inFlight = null;
}

export async function loadVoiceConfig(): Promise<VoiceConfig> {
  const munsitKey = Deno.env.get("MUNSIT_API_KEY");
  const catalogue = munsitKey ? await loadCatalogue(munsitKey) : { voices: [], modelId: null };

  const pinnedVoiceIds: Partial<Record<AppDialect, string[]>> = {};
  const providerOverride: Partial<Record<AppDialect, TtsProvider | "auto">> = {};
  for (const dialect of DIALECTS) {
    pinnedVoiceIds[dialect] = pinnedFor(dialect);
    providerOverride[dialect] = providerOverrideFor(dialect);
  }

  return {
    munsitVoices: catalogue.voices,
    munsitModelId: catalogue.modelId,
    munsitAvailable: Boolean(munsitKey),
    pinnedVoiceIds,
    providerOverride,
    allowSingleVoiceEpisodes:
      Deno.env.get("TTS_ALLOW_SINGLE_VOICE_EPISODES")?.trim().toLowerCase() === "true",
    elevenLabsEgyptianVoiceIds: ELEVENLABS_EGYPTIAN_VOICE_IDS,
    elevenLabsModelId: elevenLabsModel(),
    elevenLabsAvailable: Boolean(Deno.env.get("ELEVENLABS_API_KEY")),
    azureAvailable: Boolean(Deno.env.get("AZURE_SPEECH_KEY")),
  };
}

export async function planForDialect(
  dialect: string,
  opts: { minVoices?: number } = {},
): Promise<VoicePlan> {
  const plan = planVoices(dialect, await loadVoiceConfig(), opts);
  if (plan.source === "azure-emergency") {
    // Loud on purpose. In normal operation every dialect resolves to Munsit, so
    // this line appearing at all means discovery is failing — and the audio
    // still plays, which is exactly how a permanent regression stays invisible.
    console.warn(
      `ttsVoiceRouting: ${normalizeDialect(dialect)} fell through to Azure. ` +
        `Munsit discovery or credentials are failing.`,
    );
  }
  return plan;
}

// ── Provider IO ──────────────────────────────────────────────────────────────

/** Model override knob for A/B-ing eleven_v3 against the current default. */
export function elevenLabsModel(): string {
  return Deno.env.get("ELEVENLABS_TTS_MODEL")?.trim() || "eleven_multilingual_v2";
}

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export async function synthesizeAzure(text: string, voice: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = Deno.env.get("AZURE_SPEECH_KEY");
  if (!key) throw new Error("AZURE_SPEECH_KEY missing");
  const endpoint = Deno.env.get("AZURE_SPEECH_ENDPOINT");
  const region = Deno.env.get("AZURE_SPEECH_REGION") ?? "eastus";
  const url = endpoint
    ? `${endpoint.replace(/\/$/, "")}/tts/cognitiveservices/v1`
    : `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const locale = voice.split("-").slice(0, 2).join("-");
  const ssml =
    `<speak version='1.0' xml:lang='${locale}'><voice name='${voice}'>${escapeXml(text)}</voice></speak>`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "lahja-listen",
    },
    body: ssml,
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Azure TTS ${resp.status}: ${err.slice(0, 200)}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

export async function synthesizeMunsit(
  text: string,
  voiceId: string,
  modelId: string,
  opts: { stability?: number; speed?: number } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const key = Deno.env.get("MUNSIT_API_KEY");
  if (!key) throw new Error("MUNSIT_API_KEY missing");
  const resp = await fetch(`${MUNSIT_BASE}/text-to-speech/${encodeURIComponent(modelId)}`, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      voice_id: voiceId,
      text,
      // Higher stability → calmer, less "shouty" delivery. Podcast dialogue
      // sounds fine at 0.6; long narration benefits from 0.75+.
      stability: typeof opts.stability === "number" ? opts.stability : 0.6,
      speed: typeof opts.speed === "number" ? opts.speed : 1.0,
      streaming: false,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Munsit TTS ${resp.status}: ${err.slice(0, 200)}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

export interface ElevenLabsOpts {
  stability?: number;
  style?: number;
  /** Surrounding lines, so intonation flows across line boundaries. */
  previousText?: string;
  nextText?: string;
}

export async function synthesizeElevenLabs(
  text: string,
  voiceId: string,
  modelId: string,
  opts: ElevenLabsOpts = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const key = Deno.env.get("ELEVENLABS_API_KEY");
  if (!key) throw new Error("ELEVENLABS_API_KEY missing");
  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: modelId,
        ...(opts.previousText ? { previous_text: opts.previousText.slice(-600) } : {}),
        ...(opts.nextText ? { next_text: opts.nextText.slice(0, 600) } : {}),
        voice_settings: {
          stability: opts.stability ?? 0.4,
          similarity_boost: 0.8,
          style: opts.style ?? 0.5,
          use_speaker_boost: true,
        },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`ElevenLabs TTS ${resp.status}: ${err.slice(0, 200)}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

export interface SynthesizeOpts extends ElevenLabsOpts {
  speed?: number;
}

/** One attempt against the plan's provider, using the voice in `slot`. */
export function synthesizeWithPlan(
  text: string,
  plan: VoicePlan,
  slot: number,
  opts: SynthesizeOpts = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const voice = plan.voices[slot % plan.voices.length];
  if (plan.provider === "munsit") {
    return synthesizeMunsit(text, voice, plan.modelId!, {
      stability: opts.stability,
      speed: opts.speed,
    });
  }
  if (plan.provider === "elevenlabs") {
    return synthesizeElevenLabs(text, voice, plan.modelId ?? elevenLabsModel(), opts);
  }
  return synthesizeAzure(text, voice);
}

export interface SynthesizedAudio {
  bytes: Uint8Array<ArrayBuffer>;
  plan: VoicePlan;
}

/**
 * Plan, synthesize, and drop to Azure if the chosen provider fails outright.
 *
 * The retry matters more now than it did when providers were split per dialect:
 * every dialect resolves to the same Munsit account, so one outage is an outage
 * for the whole app rather than for a third of it. Azure is the floor, and the
 * returned plan reports which rung actually produced the bytes so the caller can
 * set the right content type.
 */
export async function synthesizeForDialect(
  text: string,
  dialect: string,
  opts: SynthesizeOpts & { role?: string; index?: number; minVoices?: number } = {},
): Promise<SynthesizedAudio> {
  const { role = "", index = 0, minVoices, ...synthOpts } = opts;
  const plan = await planForDialect(dialect, { minVoices });
  const slot = pickVoiceSlot(role, index);

  try {
    return { bytes: await synthesizeWithPlan(text, plan, slot, synthOpts), plan };
  } catch (err) {
    if (plan.provider === "azure") throw err;
    console.warn(
      `ttsVoiceRouting: ${plan.provider} failed for ${normalizeDialect(dialect)}, ` +
        `falling back to Azure:`,
      err,
    );
    const fallback = planVoices(dialect, {
      ...(await loadVoiceConfig()),
      munsitAvailable: false,
      elevenLabsAvailable: false,
    }, { minVoices });
    return { bytes: await synthesizeWithPlan(text, fallback, slot, synthOpts), plan: fallback };
  }
}

// Re-exported from the core so callers need only this module.
export { pickVoiceSlot, slotsNeeded } from "./ttsVoiceRoutingCore.ts";
export type { VoiceConfig, VoicePlan, TtsProvider, AppDialect } from "./ttsVoiceRoutingCore.ts";
