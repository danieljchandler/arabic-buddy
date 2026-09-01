/**
 * score-monologue
 *
 * Transcribes a learner's free-speech monologue take with word-level
 * timestamps and computes utterance-fluency metrics from the timings
 * (_shared/fluencyMetricsCore.ts). Persists the attempt so the learner's
 * trend view — and, later, internal calibration of what "fluent" means for
 * each dialect and level — can be built from real data. Deliberately returns
 * raw measures and no verdict: no Arabic fluency norms exist to band against
 * (docs/plateau-research-2026-09.md §5).
 *
 * ASR: Soniox first, because it returns per-token timings — the whole point.
 * Munsit is the fallback when Soniox is unavailable; it returns text only, so
 * the attempt degrades to a transcript with `timingsAvailable: false` rather
 * than failing.
 *
 * Body: {
 *   audioBase64: string,
 *   mimeType?: string,       // default audio/webm
 *   dialect?: string,        // Gulf | Egyptian | Yemeni, default Gulf
 *   promptText?: string,     // what the learner was asked to talk about
 *   durationMs?: number      // recording length as the client measured it
 * }
 * Response: {
 *   attemptId: string | null,   // null if the write failed; scoring still returns
 *   transcript: string,
 *   wordCount: number,
 *   metrics: FluencyMetrics | null,  // null when no timings were available
 *   provider: "soniox" | "munsit",
 *   timingsAvailable: boolean
 * }
 *
 * Rows are written under the service role (a fluency history the learner
 * could author is worthless as a calibration corpus); enforceDailyCap is the
 * authorization decision — signed-in callers only, acting on themselves.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import {
  SONIOX_MODEL,
  buildSonioxContext,
  munsitFallbackModel,
  munsitModel,
  type DialectModule,
} from "../_shared/asrConfig.ts";
import {
  computeFluencyMetrics,
  type FluencyMetrics,
  type TimedWord,
} from "../_shared/fluencyMetricsCore.ts";
import { emitMetric } from "../_shared/featureMetrics.ts";

const SONIOX_BASE = "https://api.soniox.com/v1";
const MUNSIT_BASE = "https://api.munsit.com/api/v1";
const POLL_INTERVAL_MS = 2000;
/** Async transcription of a minutes-long take needs real polling room. */
const MAX_POLL_MS = 3 * 60 * 1000;
/** ~5 minutes of opus is 3-4MB; anything past this is not a monologue. */
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
/** Free takes per day. Subscribers are uncapped, like the other scorers. */
const FREE_DAILY_LIMIT = 12;

function parseDialect(raw: unknown): DialectModule {
  return raw === "Egyptian" || raw === "Yemeni" ? raw : "Gulf";
}

function decodeBase64(audioBase64: string) {
  const bin = atob(audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Merge Soniox's sub-word tokens into words with timings, in seconds.
 * Same merging as soniox-transcribe: a token starting with a space (or after
 * a flush) opens a new word; others continue the current one.
 */
function mergeSonioxTokens(
  tokens: Array<{ text?: string; start_ms?: number; end_ms?: number }>,
): TimedWord[] {
  const words: TimedWord[] = [];
  let currentWord = "";
  let wordStart = 0;
  let wordEnd = 0;

  const flush = () => {
    if (currentWord) {
      words.push({ text: currentWord, start: wordStart / 1000, end: Math.max(wordEnd, wordStart) / 1000 });
      currentWord = "";
    }
  };

  for (const token of tokens) {
    const tokenText: string = token.text ?? "";
    if (tokenText === "" || tokenText === " ") {
      flush();
      continue;
    }
    if (tokenText.startsWith(" ") || !currentWord) {
      flush();
      currentWord = tokenText.trimStart();
      wordStart = token.start_ms ?? 0;
      // Some tokens omit end_ms on the first sub-word; the token's own
      // start_ms is a safe lower bound (same fix as the pipeline copy).
      wordEnd = token.end_ms ?? token.start_ms ?? 0;
    } else {
      currentWord += tokenText;
      wordEnd = token.end_ms ?? token.start_ms ?? wordEnd;
    }
  }
  flush();
  return words;
}

interface Transcription {
  text: string;
  words: TimedWord[] | null;
  provider: "soniox" | "munsit";
}

async function sonioxTranscribe(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
  dialect: DialectModule,
  apiKey: string,
): Promise<Transcription> {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };

  const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("mp4") ? "m4a" : "webm";
  const uploadForm = new FormData();
  uploadForm.append("file", new File([new Blob([bytes], { type: mimeType })], `monologue.${ext}`, { type: mimeType }));

  const uploadResp = await fetch(`${SONIOX_BASE}/files`, {
    method: "POST",
    headers,
    body: uploadForm,
    signal: AbortSignal.timeout(60_000),
  });
  if (!uploadResp.ok) throw new Error(`Soniox upload ${uploadResp.status}: ${(await uploadResp.text()).slice(0, 200)}`);
  const fileId = (await uploadResp.json()).id as string;

  try {
    const createResp = await fetch(`${SONIOX_BASE}/transcriptions`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        model: SONIOX_MODEL,
        file_id: fileId,
        language_hints: ["ar", "en"],
        context: buildSonioxContext(dialect),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!createResp.ok) throw new Error(`Soniox create ${createResp.status}: ${(await createResp.text()).slice(0, 200)}`);
    const created = await createResp.json();

    const startTime = Date.now();
    let status = created.status;
    let lastError = "";
    while (status !== "completed") {
      if (status === "error") throw new Error(`Soniox transcription failed: ${lastError || "unknown"}`);
      if (Date.now() - startTime > MAX_POLL_MS) throw new Error("Soniox polling timed out");
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const pollResp = await fetch(`${SONIOX_BASE}/transcriptions/${created.id}`, {
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (!pollResp.ok) {
        await pollResp.text();
        continue;
      }
      const polled = await pollResp.json();
      status = polled.status;
      lastError = polled.error_message ?? polled.error ?? "";
    }

    const transcriptResp = await fetch(`${SONIOX_BASE}/transcriptions/${created.id}/transcript`, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!transcriptResp.ok) throw new Error(`Soniox transcript ${transcriptResp.status}`);
    const transcriptData = await transcriptResp.json();

    return {
      text: (transcriptData.text ?? "") as string,
      words: mergeSonioxTokens(transcriptData.tokens ?? []),
      provider: "soniox",
    };
  } finally {
    fetch(`${SONIOX_BASE}/files/${fileId}`, { method: "DELETE", headers }).catch(() => {});
  }
}

async function munsitTranscribe(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
  apiKey: string,
): Promise<Transcription> {
  const callModel = async (model: string): Promise<string> => {
    const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("mp4") ? "m4a" : "webm";
    const fd = new FormData();
    fd.append("file", new File([new Blob([bytes], { type: mimeType })], `monologue.${ext}`, { type: mimeType }));
    fd.append("model", model);
    const resp = await fetch(`${MUNSIT_BASE}/audio/transcribe`, {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: fd,
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) throw new Error(`Munsit ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const raw = await resp.json();
    const payload = raw?.data ?? raw ?? {};
    return ((payload.transcription ?? raw.transcription ?? "") as string).toString();
  };

  const primary = munsitModel();
  let text = await callModel(primary);
  if (!text.trim()) text = await callModel(munsitFallbackModel(primary));
  return { text, words: null, provider: "munsit" };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const cap = await enforceDailyCap(req, "score-monologue", FREE_DAILY_LIMIT, corsHeaders);
    if (cap.limited) return cap.response;

    const { audioBase64, mimeType, dialect: rawDialect, promptText, durationMs } = await req.json();
    if (!audioBase64 || typeof audioBase64 !== "string") {
      return new Response(JSON.stringify({ error: "audioBase64 is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bytes = decodeBase64(audioBase64);
    if (bytes.length > MAX_AUDIO_BYTES) {
      return new Response(JSON.stringify({ error: "audio too large" }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dialect = parseDialect(rawDialect);
    const effectiveMime = String(mimeType || "audio/webm").split(";")[0].trim();

    // Soniox for timings; Munsit keeps the feature alive without them.
    let transcription: Transcription;
    const sonioxKey = Deno.env.get("SONIOX_API_KEY");
    const munsitKey = Deno.env.get("MUNSIT_API_KEY");
    if (sonioxKey) {
      try {
        transcription = await sonioxTranscribe(bytes, effectiveMime, dialect, sonioxKey);
      } catch (err) {
        console.warn("score-monologue: Soniox failed, falling back to Munsit:", err instanceof Error ? err.message : err);
        if (!munsitKey) throw err;
        transcription = await munsitTranscribe(bytes, effectiveMime, munsitKey);
      }
    } else if (munsitKey) {
      transcription = await munsitTranscribe(bytes, effectiveMime, munsitKey);
    } else {
      throw new Error("No ASR configured: SONIOX_API_KEY and MUNSIT_API_KEY are both missing");
    }

    const clientDurationSec = Number.isFinite(Number(durationMs)) && Number(durationMs) > 0
      ? Number(durationMs) / 1000
      : 0;

    const timingsAvailable = (transcription.words?.length ?? 0) > 0;
    const metrics: FluencyMetrics | null = timingsAvailable
      ? computeFluencyMetrics(transcription.words!, clientDurationSec)
      : null;
    const wordCount = timingsAvailable
      ? metrics!.wordCount
      : transcription.text.split(/\s+/).filter(Boolean).length;

    console.log(
      `score-monologue: provider=${transcription.provider} words=${wordCount} ` +
        `timings=${timingsAvailable} durationSec=${metrics?.totalDurationSec ?? clientDurationSec}`,
    );

    // The calibration story depends on our own usage data — no Arabic fluency
    // norms exist to borrow. This is the aggregate view of what the stored
    // attempts are accumulating.
    emitMetric({
      feature: "monologue",
      event: "attempt_scored",
      dialect,
      status: timingsAvailable ? "ok" : "warn",
      count: wordCount,
      score: metrics?.speechRateSylPerSec ?? null,
      userId: cap.userId,
      meta: {
        provider: transcription.provider,
        durationSec: metrics?.totalDurationSec ?? clientDurationSec,
      },
    });

    // The attempt row is the calibration corpus; a failed write must not eat
    // the response the learner is waiting on.
    let attemptId: string | null = null;
    try {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data, error } = await admin
        .from("monologue_attempts")
        .insert({
          user_id: cap.userId,
          dialect,
          prompt_text: typeof promptText === "string" && promptText.trim() ? promptText.slice(0, 2000) : null,
          duration_ms: Math.round(clientDurationSec * 1000) || Math.round((metrics?.totalDurationSec ?? 0) * 1000),
          transcript: transcription.text,
          word_count: wordCount,
          metrics: metrics ?? {},
          asr_provider: transcription.provider,
          timings_available: timingsAvailable,
        })
        .select("id")
        .single();
      if (error) throw error;
      attemptId = (data as { id: string }).id;
    } catch (err) {
      console.error("score-monologue: attempt write failed:", err instanceof Error ? err.message : err);
    }

    return new Response(
      JSON.stringify({
        attemptId,
        transcript: transcription.text,
        wordCount,
        metrics,
        provider: transcription.provider,
        timingsAvailable,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("score-monologue error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
