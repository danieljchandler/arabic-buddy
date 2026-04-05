import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { word_arabic, word_english, scores, dialect } = await req.json();

    if (!scores) {
      return new Response(JSON.stringify({ error: "scores is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const isSingleWord = (word_arabic || "").trim().split(/\s+/).length === 1;

    // Build a concise summary of the scores for the prompt
    const wordBreakdown = (scores.words || [])
      .map((w: any) => {
        const phonemeDetail = (w.phonemes || [])
          .filter((p: any) => p.accuracy < 70)
          .map((p: any) => `${p.phoneme}(${Math.round(p.accuracy)})`)
          .join(", ");
        return `"${w.word}" accuracy=${Math.round(w.accuracy)} error=${w.errorType}${phonemeDetail ? ` weak_phonemes=[${phonemeDetail}]` : ""}`;
      })
      .join("\n");

    const dialectLabel = dialect === "ar-EG" ? "Egyptian Arabic" : dialect === "ar-YE" ? "Yemeni Arabic" : "Gulf Arabic (Saudi/Khaliji)";

    const prompt = `You are a friendly Arabic pronunciation coach specializing in ${dialectLabel}.

A learner just attempted to pronounce: "${word_arabic}"${word_english ? ` (meaning: "${word_english}")` : ""}.

Here are their Azure Speech Assessment scores:
- Overall: ${Math.round(scores.overall)}/100
- Accuracy: ${Math.round(scores.accuracy)}/100
- Fluency: ${Math.round(scores.fluency)}/100
- Completeness: ${Math.round(scores.completeness)}/100
- Recognized text: "${scores.recognizedText}"

Per-word breakdown:
${wordBreakdown || "N/A"}

${isSingleWord
  ? "This is a single word. Focus on phoneme-level feedback."
  : "This is a phrase. Include word-level and fluency feedback."}

Give exactly 2-3 short, actionable tips (one sentence each) to improve their pronunciation. Be encouraging but specific. Reference the actual Arabic words/sounds. Do not repeat the scores.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a concise Arabic pronunciation coach. Return ONLY a JSON array of tip strings, no markdown, no explanation." },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_tips",
              description: "Return pronunciation coaching tips",
              parameters: {
                type: "object",
                properties: {
                  tips: {
                    type: "array",
                    items: { type: "string" },
                    description: "2-3 short actionable pronunciation tips",
                  },
                },
                required: ["tips"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_tips" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again later" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await response.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let tips: string[] = [];

    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        tips = parsed.tips || [];
      } catch {
        console.error("Failed to parse tool call arguments");
      }
    }

    return new Response(JSON.stringify({ tips }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pronunciation-feedback error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
