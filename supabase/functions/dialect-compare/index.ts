// dialect-compare — uses Gemini via Lovable AI gateway

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DialectComparison {
  word_arabic: string;
  word_english: string;
  dialects: {
    dialect: string;
    country: string;
    word: string;
    transliteration: string;
    pronunciation_notes?: string;
    usage_context?: string;
    formality?: string;
  }[];
  cultural_notes?: string;
  common_root?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { word, source_dialect = "Gulf" } = await req.json();

    if (!word) {
      return new Response(
        JSON.stringify({ error: "Word or phrase required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const systemPrompt = `You are an expert in Arabic dialects, particularly Gulf Arabic, Egyptian Arabic, Levantine Arabic (Syrian/Lebanese/Palestinian/Jordanian), and Modern Standard Arabic (MSA).

Your task is to show how a word or phrase differs across these major Arabic dialect groups.

For each dialect, provide:
1. The word/phrase in Arabic script
2. Transliteration (using common English phonetics)
3. Brief pronunciation notes if there are significant differences
4. Usage context (formal, informal, specific regions)
5. Formality level (formal, casual, slang)

Also provide:
- Cultural notes about when/where each variant is used
- The common Arabic root if applicable

Return your response as valid JSON with this exact structure:
{
  "word_arabic": "the original word in Arabic",
  "word_english": "English meaning",
  "dialects": [
    {
      "dialect": "Gulf Arabic",
      "country": "UAE/Saudi/Kuwait/Qatar/Bahrain/Oman",
      "word": "Arabic script",
      "transliteration": "phonetic",
      "pronunciation_notes": "optional notes",
      "usage_context": "when/where used",
      "formality": "formal/casual/slang"
    },
    {
      "dialect": "Egyptian Arabic",
      "country": "Egypt",
      "word": "...",
      "transliteration": "...",
      "usage_context": "...",
      "formality": "..."
    },
    {
      "dialect": "Levantine Arabic", 
      "country": "Syria/Lebanon/Jordan/Palestine",
      "word": "...",
      "transliteration": "...",
      "usage_context": "...",
      "formality": "..."
    },
    {
      "dialect": "Modern Standard Arabic (MSA)",
      "country": "All Arab countries (formal)",
      "word": "...",
      "transliteration": "...",
      "usage_context": "...",
      "formality": "formal"
    }
  ],
  "cultural_notes": "Interesting cultural context about usage differences",
  "common_root": "The Arabic root if applicable (e.g., ك-ت-ب)"
}

IMPORTANT: Return ONLY valid JSON, no markdown formatting, no code blocks.`;

    const userPrompt = `Compare how "${word}" is said across Gulf Arabic, Egyptian Arabic, Levantine Arabic, and MSA. The user's source dialect is ${source_dialect}.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn("Gemini dialect-compare error:", response.status, errText.slice(0, 200));
      throw new Error("AI model failed for dialect comparison");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    if (!content) {
      throw new Error("AI model returned empty response");
    }

    // Parse the JSON response
    let comparison: DialectComparison;
    try {
      let cleanContent = content.trim();
      if (cleanContent.startsWith("```json")) {
        cleanContent = cleanContent.slice(7);
      }
      if (cleanContent.startsWith("```")) {
        cleanContent = cleanContent.slice(3);
      }
      if (cleanContent.endsWith("```")) {
        cleanContent = cleanContent.slice(0, -3);
      }
      comparison = JSON.parse(cleanContent.trim());
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      return new Response(
        JSON.stringify({ 
          error: "Failed to parse comparison",
          raw_response: content 
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ comparison }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Dialect compare error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
