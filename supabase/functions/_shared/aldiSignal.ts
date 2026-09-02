// ALDi — a continuous 0..1 "level of dialectness" for Arabic text, from the
// Sentence-ALDi model (Keleg et al. 2023), the metric AL-QASIDA builds ADI2 on
// (docs/language-learning-research-2026-09.md §8).
//
// A second, reproducible dialect signal beside msaLeakDetector's hand-kept
// word lists. Log-only for now: every generated text that goes through the
// violation logger also records its ALDi score when a model is configured,
// so the two signals can be compared against native-review outcomes before
// either is made a gate. Inert until ALDI_HF_MODEL is set — no model, no
// call, no cost.
//
// Same HuggingFace inference pattern as camelDialect.ts; the parse is pure
// and unit-tested from src/test/aldiSignal.test.ts.

export type AldiFailureReason =
  | "not_configured"
  | "no_api_key"
  | "timeout"
  | "network_error"
  | "unrecognized_response"
  | `http_${number}`;

export type AldiOutcome =
  | { ok: true; score: number }
  | { ok: false; reason: AldiFailureReason };

type EnvReader = { get(k: string): string | undefined };

/**
 * Reads the env off `globalThis` so this module still typechecks when the
 * frontend test suite imports it outside Deno (same trick as asrConfig.ts).
 */
function runtimeEnv(): EnvReader {
  const deno = (globalThis as { Deno?: { env: EnvReader } }).Deno;
  return deno?.env ?? { get: () => undefined };
}

/** The configured model id, or null when the signal is switched off. */
export function aldiModel(env: EnvReader = runtimeEnv()): string | null {
  const v = env.get("ALDI_HF_MODEL")?.trim();
  return v ? v : null;
}

/**
 * Pull a 0..1 dialectness score out of whatever shape the endpoint returns.
 * Sentence-ALDi is a regression head, which HF serves as `[[{ label, score }]]`,
 * `[{ score }]`, or a bare number depending on the pipeline; anything else is
 * "unrecognized", never a guess.
 */
export function parseAldiResponse(body: unknown): number | null {
  const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null);
  if (typeof body === "number") return clamp(body);
  if (Array.isArray(body)) {
    const first = body[0];
    if (typeof first === "number") return clamp(first);
    if (Array.isArray(first)) return parseAldiResponse(first);
    if (first && typeof first === "object" && typeof (first as { score?: unknown }).score === "number") {
      return clamp((first as { score: number }).score);
    }
  }
  if (body && typeof body === "object" && typeof (body as { score?: unknown }).score === "number") {
    return clamp((body as { score: number }).score);
  }
  return null;
}

export async function scoreAldi(
  text: string,
  opts: { model?: string | null; apiKey?: string; timeoutMs?: number; maxChars?: number } = {},
): Promise<AldiOutcome> {
  const model = opts.model ?? aldiModel();
  if (!model) return { ok: false, reason: "not_configured" };
  const env = runtimeEnv();
  const apiKey = opts.apiKey ?? env.get("HUGGINGFACE_API_KEY") ?? env.get("HF_API_KEY") ?? "";
  if (!apiKey) return { ok: false, reason: "no_api_key" };
  const sample = text.trim().slice(0, opts.maxChars ?? 512);
  if (!sample) return { ok: false, reason: "unrecognized_response" };

  const hosts = [
    `https://router.huggingface.co/hf-inference/models/${model}`,
    `https://api-inference.huggingface.co/models/${model}`,
  ];
  let last: AldiFailureReason = "network_error";
  for (const url of hosts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
    try {
      const resp = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: sample }),
      });
      if (!resp.ok) {
        last = `http_${resp.status}` as AldiFailureReason;
        if (resp.status === 404) continue;
        return { ok: false, reason: last };
      }
      const score = parseAldiResponse(await resp.json());
      return score === null ? { ok: false, reason: "unrecognized_response" } : { ok: true, score };
    } catch (e) {
      last = e instanceof DOMException && e.name === "AbortError" ? "timeout" : "network_error";
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false, reason: last };
}
