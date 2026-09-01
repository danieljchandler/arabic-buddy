/**
 * practice-chunk-coach
 *
 * The chunk-in-situation coach (plateau plan Phase 4a). The set-phrase quiz
 * checks verbatim reproduction; this checks the harder, realer skill — given
 * the phrase's situation, can the learner deploy the chunk inside their OWN
 * free-form answer? The learner speaks freely, Munsit transcribes, and the
 * brain judges whether the chunk (or a listed variant) appeared naturally,
 * rewriting what the learner actually said — the salience-first feedback
 * shape the output research demands.
 *
 * Body: { audioBase64: string, mimeType?: string, phraseId: string }
 * Response: {
 *   transcript, used_chunk, understandable, natural, verdict,
 *   natural_rewrite, natural_rewrite_english, tips: string[],
 *   quality: 1 | 2 | 4 | 5    // the FSRS grade the caller feeds the
 * }                            // phrase's PRODUCTION track (mode "voice")
 *
 * quality is derived here, deterministically, rather than asked of the model:
 * didn't use the chunk → 1; used it but incomprehensibly → 2; used it and
 * understood → 4; used it, understood, and nothing worth fixing → 5. The
 * caller's schedule maps 4/5 to accepted — same bands as the exact-match
 * scorer, so the two paths grade one track consistently.
 *
 * The phrase's own dialect is authoritative (recorded errors must land in the
 * bucket the learner profile reads), and misses are recorded under the
 * chunk_coach source; a clean run resolves earlier errors on the phrase.
 * Anonymous callers get coached under the IP cap — the public practice page
 * pattern — but nothing is recorded or resolved for them.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceAnonymousDailyCap } from "../_shared/usageCap.ts";
import { munsitFallbackModel, munsitModel } from "../_shared/asrConfig.ts";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import {
  getDialectLabel,
  getDialectTransliterationRules,
  type Dialect,
} from "../_shared/dialectHelpers.ts";
import {
  recordLearnerErrorsForRequest,
  resolveLearnerErrorsForRequest,
} from "../_shared/learnerErrors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";
import { emitMetric } from "../_shared/featureMetrics.ts";

const MUNSIT_BASE = "https://api.munsit.com/api/v1";

interface ChunkCoachJudgement {
  used_chunk: boolean;
  understandable: boolean;
  natural: boolean;
  verdict: string;
  natural_rewrite: string;
  natural_rewrite_english: string;
  tips: string[];
}

function toDialect(d?: string): Dialect {
  if (d === "Egyptian") return "Egyptian";
  if (d === "Yemeni") return "Yemeni";
  return "Gulf";
}

async function munsitCall(audioBase64: string, mimeType: string, apiKey: string, model: string): Promise<string> {
  const bin = atob(audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType || "audio/webm" });
  const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("mp4") ? "m4a" : "webm";
  const fd = new FormData();
  fd.append("file", new File([blob], `utterance.${ext}`, { type: blob.type }));
  fd.append("model", model);

  const resp = await fetch(`${MUNSIT_BASE}/audio/transcribe`, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: fd,
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Munsit ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data?.data?.transcription ?? data?.transcription ?? "").toString().trim();
}

async function munsitTranscribe(audioBase64: string, mimeType: string, apiKey: string): Promise<string> {
  const primary = munsitModel();
  const first = await munsitCall(audioBase64, mimeType, apiKey, primary);
  if (first.trim()) return first;
  const fallback = munsitFallbackModel(primary);
  console.warn(`munsit: empty transcription from ${primary} — retrying with ${fallback}`);
  return await munsitCall(audioBase64, mimeType, apiKey, fallback);
}

serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Same posture as score-set-phrase-voice next door: the practice page is
    // public, so anonymous callers are IP-capped rather than turned away.
    const cap = await enforceAnonymousDailyCap(req, "practice-chunk-coach", 15, cors);
    if (cap.limited) return cap.response;

    const { audioBase64, mimeType, phraseId } = await req.json();
    if (!audioBase64 || !phraseId) {
      return new Response(
        JSON.stringify({ error: "audioBase64 and phraseId are required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // The phrase first, so a bad id costs no ASR.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: phrase, error: phraseError } = await admin
      .from("set_phrases")
      .select("phrase_arabic, phrase_english, scenario_english, accepted_variants, dialect")
      .eq("id", phraseId)
      .maybeSingle();
    if (phraseError) throw phraseError;
    if (!phrase?.phrase_arabic) throw new Error("phrase not found");

    const munsitKey = Deno.env.get("MUNSIT_API_KEY");
    if (!munsitKey) throw new Error("MUNSIT_API_KEY not configured");

    const transcript = await munsitTranscribe(audioBase64, mimeType || "audio/webm", munsitKey);
    if (!transcript) {
      return new Response(
        JSON.stringify({
          transcript: "",
          empty: true,
          message: "We couldn't hear anything — try recording again, a bit closer to the mic.",
        }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const dialect = toDialect(phrase.dialect as string);
    const dLabel = getDialectLabel(dialect);
    const variants = (Array.isArray(phrase.accepted_variants) ? phrase.accepted_variants : [])
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0);

    let brain;
    try {
      brain = await askBrain<ChunkCoachJudgement>({
        purpose: "practice_chunk_coach",
        dialect,
        strategy: "solo",
        models: [MODEL_IDS.GEMINI_FLASH],
        temperature: 0.4,
        maxTokens: 1024,
        systemPromptExtra:
          `You are a warm, encouraging Arabic tutor specializing in ${dLabel}. The learner is practising ` +
          `deploying a fixed phrase (a chunk) inside their own free speech — the skill that makes speech ` +
          `fluent. Be GENEROUS with pronunciation: the transcript comes from ASR and may contain small ` +
          `errors. Judge word choice and naturalness, never accent, and never demand Modern Standard ` +
          `Arabic.\n\n${getDialectTransliterationRules(dialect)}`,
        userPrompt:
          `The situation: ${phrase.scenario_english ?? `a moment where a ${dLabel} speaker would say the phrase`}.\n` +
          `The chunk to deploy: "${phrase.phrase_arabic}"` +
          (phrase.phrase_english ? ` (meaning: "${phrase.phrase_english}")` : "") +
          (variants.length > 0 ? `. Accepted variants: ${variants.join("، ")}` : "") +
          `.\n\nASR transcript of the learner's free-form answer: "${transcript}"\n\n` +
          `Assess:\n` +
          `1. used_chunk: did the answer contain the chunk or an accepted variant (small ASR distortions allowed)?\n` +
          `2. understandable: would a native speaker understand the whole answer?\n` +
          `3. natural: is the answer already natural ${dLabel} with nothing worth fixing?\n` +
          `4. natural_rewrite: the learner's OWN answer, minimally repaired into natural ${dLabel} — keep their ` +
          `meaning and voice, and include the chunk. Not a fresh model answer.\n` +
          `5. verdict: one short encouraging English sentence.\n` +
          `6. tips: 1-2 short usage tips, only if genuinely useful.\n` +
          `Reply via the tool ONLY.`,
        arabicTextPath: (p) => (p as ChunkCoachJudgement | null)?.natural_rewrite ?? "",
        tool: {
          name: "judge_chunk_answer",
          description: "Judgement of a free-form answer that should deploy the chunk.",
          parameters: {
            type: "object",
            properties: {
              used_chunk: { type: "boolean" },
              understandable: { type: "boolean" },
              natural: { type: "boolean", description: "True only when nothing is worth fixing." },
              verdict: { type: "string" },
              natural_rewrite: { type: "string", description: "The learner's answer, minimally repaired, Arabic script." },
              natural_rewrite_english: { type: "string" },
              tips: { type: "array", items: { type: "string" } },
            },
            required: [
              "used_chunk",
              "understandable",
              "natural",
              "verdict",
              "natural_rewrite",
              "natural_rewrite_english",
              "tips",
            ],
          },
        },
      });
    } catch (e) {
      if (e instanceof BrainHttpError && (e.status === 429 || e.status === 402)) {
        return new Response(
          JSON.stringify({ error: e.status === 429 ? "Rate limited — try again in a moment." : "AI credits exhausted." }),
          { status: e.status, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      throw e;
    }

    const judgement = brain.output as ChunkCoachJudgement;
    // Deterministic grade for the phrase's production schedule — see header.
    const quality = !judgement.used_chunk
      ? 1
      : !judgement.understandable
        ? 2
        : judgement.natural
          ? 5
          : 4;

    // Feed the weak-set loop under the coach's own source; a clean deploy
    // resolves what earlier attempts recorded. No-ops for anonymous callers.
    if (quality <= 2) {
      void recordLearnerErrorsForRequest(req, [{
        source: "chunk_coach",
        dialect,
        targetArabic: phrase.phrase_arabic as string,
        producedArabic: transcript,
        errorKind: judgement.used_chunk ? "other" : "wrong_word",
        detail: { verdict: judgement.verdict, natural_rewrite: judgement.natural_rewrite },
      }]);
    } else {
      void resolveLearnerErrorsForRequest(req, phrase.phrase_arabic as string, dialect);
    }

    emitMetric({
      feature: "chunk-coach",
      event: "answer_judged",
      dialect,
      status: quality >= 4 ? "ok" : "warn",
      score: quality,
    });

    return new Response(
      JSON.stringify({ transcript, ...judgement, quality }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("practice-chunk-coach error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
