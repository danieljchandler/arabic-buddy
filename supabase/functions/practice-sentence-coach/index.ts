/**
 * practice-sentence-coach
 *
 * Given a short voice recording of a learner trying to use a target Arabic
 * vocabulary word in a sentence, transcribes the utterance via Munsit ASR and
 * returns dialect-aware coaching feedback: a naturalness rewrite, 2-3
 * alternative phrasings, encouraging pronunciation tips, and a lenient
 * correctness verdict. Intentionally forgiving of non-native pronunciation —
 * focuses on intelligibility and dialect authenticity, not accent perfection.
 *
 * Body: {
 *   audioBase64: string,
 *   mimeType?: string,
 *   targetArabic: string,   // the vocabulary word / phrase the learner is practising
 *   targetEnglish?: string,
 *   dialect?: string,        // "Gulf" | "Egyptian" | "Yemeni"
 * }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const MUNSIT_BASE = "https://api.munsit.com/api/v1";

async function munsitTranscribe(audioBase64: string, mimeType: string, apiKey: string): Promise<string> {
  const bin = atob(audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType || "audio/webm" });
  const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("mp4") ? "m4a" : "webm";
  const fd = new FormData();
  fd.append("file", new File([blob], `utterance.${ext}`, { type: blob.type }));
  fd.append("model", "munsit");

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
  // Munsit nests transcript under data.data.transcription (see model registry notes)
  return (data?.data?.transcription ?? data?.transcription ?? "").toString().trim();
}

function dialectLabel(d?: string): string {
  if (d === "Egyptian") return "Egyptian Arabic (مصري)";
  if (d === "Yemeni") return "Yemeni Arabic (يمني)";
  return "Gulf Arabic / Khaleeji (خليجي)";
}

serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { audioBase64, mimeType, targetArabic, targetEnglish, dialect } = await req.json();
    if (!audioBase64 || !targetArabic) {
      return new Response(
        JSON.stringify({ error: "audioBase64 and targetArabic are required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const munsitKey = Deno.env.get("MUNSIT_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!munsitKey) throw new Error("MUNSIT_API_KEY not configured");
    if (!lovableKey) throw new Error("LOVABLE_API_KEY not configured");

    // Step 1: Transcribe
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

    // Step 2: Coach via Lovable AI Gateway (Gemini 3.5 Flash — fast + good Arabic).
    const dLabel = dialectLabel(dialect);
    const system =
      `You are a warm, encouraging Arabic tutor specializing in ${dLabel}. ` +
      `You coach non-native learners who are just starting to speak. Be GENEROUS with pronunciation — ` +
      `if the transcript is close to what the learner likely meant, treat it as understood. Focus on ` +
      `natural dialect phrasing, grammar, and word usage, NOT on accent perfection. ` +
      `Never demand Modern Standard Arabic — stay in ${dLabel} throughout.`;

    const userPrompt =
      `The learner is practising the word "${targetArabic}"` +
      (targetEnglish ? ` (meaning: "${targetEnglish}")` : "") +
      ` by trying to say a sentence with it.\n\n` +
      `ASR transcript of what they said (may contain small ASR errors — be lenient): "${transcript}"\n\n` +
      `Assess:\n` +
      `1. Did they use the target word (or a close variant)?\n` +
      `2. Is the sentence understandable and natural in ${dLabel}?\n` +
      `3. Provide a corrected/more natural rewrite in ${dLabel} — keep it close to their intent.\n` +
      `4. Give 2 alternative ways a native ${dLabel} speaker might say the same idea.\n` +
      `5. Give 1-2 short, encouraging pronunciation/usage tips (not accent nitpicks).\n` +
      `Reply via the return_feedback tool ONLY.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_feedback",
              description: "Return sentence-practice coaching feedback",
              parameters: {
                type: "object",
                properties: {
                  used_target_word: {
                    type: "boolean",
                    description: "True if the learner used the target word or a close variant.",
                  },
                  understandable: {
                    type: "boolean",
                    description: "True if a native speaker would understand the intent, even with mistakes.",
                  },
                  verdict: {
                    type: "string",
                    description: "One short encouraging sentence summarising how it went.",
                  },
                  natural_rewrite: {
                    type: "string",
                    description: "The learner's sentence rewritten naturally in the target dialect. Arabic script.",
                  },
                  natural_rewrite_english: {
                    type: "string",
                    description: "English gloss of the natural rewrite.",
                  },
                  alternatives: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        arabic: { type: "string" },
                        english: { type: "string" },
                      },
                      required: ["arabic", "english"],
                      additionalProperties: false,
                    },
                    description: "2 alternative native phrasings.",
                  },
                  tips: {
                    type: "array",
                    items: { type: "string" },
                    description: "1-2 short encouraging usage/pronunciation tips.",
                  },
                },
                required: [
                  "used_target_word",
                  "understandable",
                  "verdict",
                  "natural_rewrite",
                  "natural_rewrite_english",
                  "alternatives",
                  "tips",
                ],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_feedback" } },
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited — please try again in a moment." }),
          { status: 429, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      if (aiResp.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted — please add funds." }),
          { status: 402, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      const text = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, text.slice(0, 500));
      throw new Error(`AI gateway ${aiResp.status}`);
    }

    const aiData = await aiResp.json();
    const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
    let feedback: Record<string, unknown> = {};
    if (toolCall?.function?.arguments) {
      try {
        feedback = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        console.error("Failed to parse tool arguments:", e);
      }
    }

    return new Response(
      JSON.stringify({ transcript, ...feedback }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("practice-sentence-coach error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
