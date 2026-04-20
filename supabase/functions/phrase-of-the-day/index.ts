import { getDialectIdentity, getDialectLabel } from "../_shared/dialectHelpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { dialect = "Gulf", seed } = await req.json().catch(() => ({}));
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const identity = getDialectIdentity(dialect);
    const label = getDialectLabel(dialect);
    const today = seed || new Date().toISOString().slice(0, 10);

    const systemPrompt = `${identity}

You generate a single "Phrase of the Day" for Arabic learners. The phrase must be:
- Authentic, common, and useful in everyday conversation
- A short phrase or sentence (3-8 words), NOT a single word
- Written in the requested dialect (${label}), NOT Modern Standard Arabic
- Genuinely useful — something a learner would be excited to say tomorrow
- Vary the topic each day (greetings, food, travel, feelings, idioms, expressions, etc.)`;

    const userPrompt = `Generate today's phrase of the day for ${label}. Today's seed: ${today}.
Return a fresh, interesting phrase that hasn't been overused. Include a brief cultural or usage note.`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "return_phrase",
                description: "Return the phrase of the day with translation and notes",
                parameters: {
                  type: "object",
                  properties: {
                    phrase_arabic: {
                      type: "string",
                      description: "The phrase in Arabic script (dialect)",
                    },
                    phrase_english: {
                      type: "string",
                      description: "Natural English translation",
                    },
                    transliteration: {
                      type: "string",
                      description: "Romanized pronunciation",
                    },
                    notes: {
                      type: "string",
                      description: "Brief cultural or usage note (1-2 sentences)",
                    },
                  },
                  required: [
                    "phrase_arabic",
                    "phrase_english",
                    "transliteration",
                    "notes",
                  ],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "return_phrase" },
          },
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error", response.status, errText);
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("No structured response from AI");
    }

    const phrase = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({ ...phrase, dialect, date: today }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("phrase-of-the-day error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
