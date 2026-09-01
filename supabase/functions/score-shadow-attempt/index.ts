/**
 * score-shadow-attempt
 *
 * Scores a learner's shadowing take against the ACTUAL words a native speaker
 * said in a specific clip — not a generic pronunciation model.
 *
 * It transcribes the learner's recording with Munsit ASR and compares the
 * recognised Arabic against the clip's reference transcript using normalised
 * Arabic edit-distance similarity. It also returns a per-word alignment diff
 * (matched / substituted / missing / extra vs the clip's words) that the
 * caller feeds to `pronunciation-feedback` for coaching tips.
 *
 * Body: {
 *   audioBase64: string, mimeType?: string, referenceText: string, dialect?: string,
 *   clipRef?: string,   // stable clip id — enables attempt persistence
 *   rep?: number        // 1-based take number within this clip's practice
 * }
 * Response: {
 *   recognizedText: string,
 *   transcriptSimilarity: number,   // 0..1 — how close to the clip's words
 *   wordDiffs: Array<{ ref?: string, said?: string, status: 'match'|'sub'|'missing'|'extra' }>
 * }
 *
 * Signed-in takes with a clipRef are persisted to shadow_attempts (service
 * role; owner-read RLS) — the record behind the rep-progression UI, and the
 * history that will let gain durability be measured, which the shadowing
 * literature never has (one delayed post-test in 44 studies).
 *
 * Required env: MUNSIT_API_KEY (already used by score-set-phrase-voice).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceAnonymousDailyCap } from "../_shared/usageCap.ts";
import { munsitModel, munsitFallbackModel } from "../_shared/asrConfig.ts";
import {
  recordLearnerErrorsForRequest,
  resolveLearnerErrorsForRequest,
} from "../_shared/learnerErrors.ts";
import { contributeLearnerAudio } from "../_shared/learnerAudioContribution.ts";
import { normalizeDialect } from "../_shared/transcriptDiffCore.ts";
import { resolveUserId } from "../_shared/usageCap.ts";
import { arabicSimilarity as similarity, normalizeArabic } from "../_shared/arabicMatch.ts";


const MUNSIT_BASE = "https://api.munsit.com/api/v1";

type WordStatus = "match" | "sub" | "missing" | "extra";
interface WordDiff {
  ref?: string;
  said?: string;
  status: WordStatus;
}

/**
 * Character similarity at or above which two tokens count as the same word
 * rather than a substitution.
 *
 * This was 0.6, which on a five-letter word calls two wrong letters a match —
 * the coach then had nothing to say about a word the learner plainly did not
 * say. 0.7 still absorbs the one-letter differences ASR invents on its own
 * without turning them into corrections.
 */
const WORD_MATCH = 0.7;

/**
 * Token-level alignment of reference vs recognised words via edit-distance
 * backtrace. Yields per-token status so the coach can point at specific words.
 */
function alignWords(reference: string, recognized: string): WordDiff[] {
  const ref = normalizeArabic(reference).split(" ").filter(Boolean);
  const said = normalizeArabic(recognized).split(" ").filter(Boolean);
  const n = ref.length;
  const m = said.length;

  if (n === 0) return said.map((w) => ({ said: w, status: "extra" as const }));
  if (m === 0) return ref.map((w) => ({ ref: w, status: "missing" as const }));

  // Cost of substituting token i for token j: 0 if similar, else 1.
  const subCost = (i: number, j: number) => (similarity(ref[i], said[j]) >= WORD_MATCH ? 0 : 1);

  // DP edit-distance table over tokens.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // missing (ref token not said)
        dp[i][j - 1] + 1, // extra (said token not in ref)
        dp[i - 1][j - 1] + subCost(i - 1, j - 1),
      );
    }
  }

  // Backtrace from (n, m).
  const diffs: WordDiff[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + subCost(i - 1, j - 1)) {
      const matched = subCost(i - 1, j - 1) === 0;
      diffs.push(
        matched
          ? { ref: ref[i - 1], said: said[j - 1], status: "match" }
          : { ref: ref[i - 1], said: said[j - 1], status: "sub" },
      );
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      diffs.push({ ref: ref[i - 1], status: "missing" });
      i--;
    } else {
      diffs.push({ said: said[j - 1], status: "extra" });
      j--;
    }
  }
  return diffs.reverse();
}

async function munsitCall(audioBase64: string, mimeType: string, apiKey: string, model: string): Promise<string> {
  const bin = atob(audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const isWav =
    (mimeType || "").includes("wav") ||
    (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46);
  const effectiveType = isWav ? "audio/wav" : mimeType || "audio/webm";
  const ext = isWav ? "wav" : effectiveType.includes("mp4") ? "m4a" : "webm";
  const blob = new Blob([bytes], { type: effectiveType });
  const fd = new FormData();
  fd.append("file", new File([blob], `utterance.${ext}`, { type: effectiveType }));
  fd.append("model", model);

  console.log(`munsit request: bytes=${bytes.length} type=${effectiveType} ext=${ext}`);

  const resp = await fetch(`${MUNSIT_BASE}/audio/transcribe`, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: fd,
    signal: AbortSignal.timeout(25_000),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Munsit ${resp.status}: ${t.slice(0, 200)}`);
  }
  const raw = await resp.json();
  console.log("munsit raw:", JSON.stringify(raw).slice(0, 500));
  const payload = raw?.data ?? raw ?? {};
  return ((payload.transcription ?? raw.transcription ?? "") as string).toString();
}

/**
 * Transcribe with the primary Munsit model, retrying once on the other model
 * when the first answer is empty. The bare `munsit` model went degraded
 * upstream (a few characters back for any payload), so the default is now
 * `munsit-en-ar` — the retry covers the reverse happening later.
 */
async function munsitTranscribe(audioBase64: string, mimeType: string, apiKey: string): Promise<string> {
  const primary = munsitModel();
  const first = await munsitCall(audioBase64, mimeType, apiKey, primary);
  if (first.trim()) return first;
  const fallback = munsitFallbackModel(primary);
  console.warn(`munsit: empty transcription from ${primary} — retrying with ${fallback}`);
  return await munsitCall(audioBase64, mimeType, apiKey, fallback);
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // verify_jwt is off and no cap existed: fully anonymous paid ASR. Same
    // ceiling as azure-pronunciation next door; IP-bucketed when signed out.
    const cap = await enforceAnonymousDailyCap(req, "score-shadow-attempt", 60, corsHeaders);
    if (cap.limited) return cap.response;

    const { audioBase64, mimeType, referenceText, dialect, clipRef, rep } = await req.json();
    if (!audioBase64 || !referenceText) {
      return new Response(JSON.stringify({ error: "audioBase64 and referenceText are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("MUNSIT_API_KEY");
    if (!apiKey) throw new Error("MUNSIT_API_KEY not configured");

    const recognizedText = await munsitTranscribe(audioBase64, mimeType || "audio/wav", apiKey);
    const transcriptSimilarity = similarity(recognizedText, referenceText);
    const wordDiffs = alignWords(referenceText, recognizedText);

    console.log(
      `shadow score sim=${transcriptSimilarity.toFixed(2)} ref="${referenceText.slice(0, 40)}" heard="${recognizedText.slice(0, 40)}"`,
    );

    // Record the words the learner dropped or substituted. This function has no
    // usage cap, so the user id comes from the bearer token directly; anonymous
    // callers simply record nothing. Fire-and-forget — scoring must not wait.
    const missed = wordDiffs.filter((d) => d.status === "missing" || d.status === "sub");
    if (missed.length > 0) {
      void recordLearnerErrorsForRequest(
        req,
        missed.map((d) => ({
          source: "shadow" as const,
          dialect,
          targetArabic: d.ref ?? "",
          producedArabic: d.said ?? null,
          errorKind: d.status === "missing" ? "omission" : "wrong_word",
          detail: { transcriptSimilarity },
        })),
      );
    } else {
      // Clean take — clear the words previously flagged, so the weak set decays
      // instead of only ever growing. Matched per word, since that's how they
      // were recorded.
      const matched = wordDiffs
        .filter((d) => d.status === "match")
        .map((d) => d.ref)
        .filter((w): w is string => !!w);
      void resolveLearnerErrorsForRequest(req, matched, dialect);
    }

    // Persist the take for signed-in learners when the caller says which clip
    // it was. Fire-and-forget like the error bookkeeping above — the score
    // response must not wait on history.
    if (typeof clipRef === "string" && clipRef.trim()) {
      void (async () => {
        try {
          const userId = await resolveUserId(req);
          if (!userId) return;
          const admin = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            { auth: { persistSession: false, autoRefreshToken: false } },
          );
          const { error } = await admin.from("shadow_attempts").insert({
            user_id: userId,
            dialect: normalizeDialect(dialect) ?? "Gulf",
            clip_ref: clipRef.trim().slice(0, 200),
            rep: Math.max(1, Math.min(50, Number(rep) || 1)),
            reference_text: String(referenceText).slice(0, 1000),
            recognized_text: recognizedText.slice(0, 1000),
            transcript_similarity: transcriptSimilarity,
          });
          if (error) console.warn("shadow_attempts insert failed:", error.message);
        } catch (e) {
          console.warn("shadow_attempts insert threw:", e);
        }
      })();
    }

    // Opt-in audio contribution (flywheel W5) — same lane as azure-pronunciation:
    // the module checks profiles.contribute_audio itself; without consent this
    // is a no-op. Shadowing clips are especially useful pairs because the
    // reference is a native-audio transcript, not an isolated word.
    try {
      const contributedDialect = normalizeDialect(dialect);
      const userId = await resolveUserId(req);
      if (userId && contributedDialect) {
        contributeLearnerAudio({
          userId,
          dialect: contributedDialect,
          audioBytes: Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0)),
          mimeType: String(mimeType || "audio/wav").split(";")[0].trim(),
          referenceText,
          recognizedText,
          score: Math.round(transcriptSimilarity * 100),
          sourceFunction: "score-shadow-attempt",
        });
      }
    } catch { /* contribution must never affect the score response */ }

    return new Response(
      JSON.stringify({ recognizedText, transcriptSimilarity, wordDiffs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("score-shadow-attempt error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
