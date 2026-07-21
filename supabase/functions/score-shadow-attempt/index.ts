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
 * Body: { audioBase64: string, mimeType?: string, referenceText: string }
 * Response: {
 *   recognizedText: string,
 *   transcriptSimilarity: number,   // 0..1 — how close to the clip's words
 *   wordDiffs: Array<{ ref?: string, said?: string, status: 'match'|'sub'|'missing'|'extra' }>
 * }
 *
 * Required env: MUNSIT_API_KEY (already used by score-set-phrase-voice).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MUNSIT_BASE = "https://api.munsit.com/api/v1";

/** Strip Arabic diacritics/tatweel and fold letter variants for fair matching. */
function normalizeArabic(s: string): string {
  if (!s) return "";
  return s
    // strip tashkeel (diacritics)
    .replace(/[ً-ٰٟؐ-ؚۖ-ۭ]/g, "")
    // tatweel
    .replace(/ـ/g, "")
    // alef variants → bare alef
    .replace(/[آأإ]/g, "ا")
    // alef maqsura → ya
    .replace(/ى/g, "ي")
    // ta marbuta → ha
    .replace(/ة/g, "ه")
    // hamza variations on waw/ya
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    // strip standalone hamza, punctuation
    .replace(/[ء،؛؟.,!?؟،؛"'()[\]{}«»]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array(b.length + 1);
  const v1 = new Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}

/** Character-level normalized similarity (0..1) between two Arabic strings. */
function similarity(a: string, b: string): number {
  const na = normalizeArabic(a);
  const nb = normalizeArabic(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}

type WordStatus = "match" | "sub" | "missing" | "extra";
interface WordDiff {
  ref?: string;
  said?: string;
  status: WordStatus;
}

/**
 * Token-level alignment of reference vs recognised words via edit-distance
 * backtrace. Yields per-token status so the coach can point at specific words.
 * A per-token character similarity ≥ 0.6 counts as a match rather than a sub.
 */
function alignWords(reference: string, recognized: string): WordDiff[] {
  const ref = normalizeArabic(reference).split(" ").filter(Boolean);
  const said = normalizeArabic(recognized).split(" ").filter(Boolean);
  const n = ref.length;
  const m = said.length;

  if (n === 0) return said.map((w) => ({ said: w, status: "extra" as const }));
  if (m === 0) return ref.map((w) => ({ ref: w, status: "missing" as const }));

  // Cost of substituting token i for token j: 0 if similar, else 1.
  const subCost = (i: number, j: number) =>
    1 - similarity(ref[i], said[j]) < 0.4 ? 0 : 1;

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

async function munsitTranscribe(audioBase64: string, mimeType: string, apiKey: string): Promise<string> {
  const bin = atob(audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType || "audio/wav" });
  const fd = new FormData();
  fd.append("file", new File([blob], "utterance." + (mimeType.includes("wav") ? "wav" : "webm"), { type: blob.type }));
  fd.append("model", "munsit");

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
  const data = await resp.json();
  return (data.transcription ?? "").toString();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { audioBase64, mimeType, referenceText } = await req.json();
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
