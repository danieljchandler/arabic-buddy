import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface TimestampedSegment {
  text: string;
  startMs: number;
  endMs: number;
}

interface ClassifiedCandidate {
  word_text: string;
  word_english: string;
  word_standard?: string;
  sentence_text?: string;
  sentence_english?: string;
  word_start_ms: number;
  word_end_ms: number;
  sentence_start_ms?: number;
  sentence_end_ms?: number;
  confidence: number;
  classification: "CONCRETE" | "ACTION" | "ABSTRACT";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { segments } = await req.json() as { segments: TimestampedSegment[] };
    
    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return new Response(JSON.stringify({ error: "No segments provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build a compact representation for the AI
    const segmentList = segments.map((s, i) => 
      `[${i}] "${s.text}" (${s.startMs}-${s.endMs}ms)`
    ).join("\n");

    const systemPrompt = `You are a Gulf Arabic language teaching assistant. You are given timestamped transcript segments from a tutor speaking Gulf Arabic.

Your task:
1. Classify each segment as VOCAB_WORD (1-3 tokens, a vocabulary item), EXAMPLE_SENTENCE (a longer utterance demonstrating usage), or OTHER (filler, greetings, instructions in English, etc.)
2. Pair each VOCAB_WORD with the nearest EXAMPLE_SENTENCE that demonstrates its usage
3. For each vocabulary word, provide:
   - English translation
   - Optional standard Arabic spelling (if the spoken form differs)
   - A confidence score (0.0-1.0) based on how clearly it's a teachable vocabulary item
   - Classification as CONCRETE (object, animal, food, place), ACTION (verb, activity), or ABSTRACT (function word, greeting, abstract concept)

Return the results using the extract_candidates tool.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Here are the transcript segments:\n\n${segmentList}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_candidates",
              description: "Extract vocabulary candidates with paired example sentences from transcript segments",
              parameters: {
                type: "object",
                properties: {
                  candidates: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        word_segment_index: { type: "number", description: "Index of the VOCAB_WORD segment" },
                        word_text: { type: "string", description: "The spoken word/phrase in Arabic" },
                        word_english: { type: "string", description: "English translation" },
                        word_standard: { type: "string", description: "Standard Arabic spelling if different from spoken" },
                        sentence_segment_index: { type: "number", description: "Index of the paired EXAMPLE_SENTENCE segment, or -1 if none" },
                        sentence_text: { type: "string", description: "The example sentence in Arabic" },
                        sentence_english: { type: "string", description: "English translation of the sentence" },
                        confidence: { type: "number", description: "Confidence score 0.0-1.0" },
                        classification: { type: "string", enum: ["CONCRETE", "ACTION", "ABSTRACT"], description: "Type of vocabulary item" },
                      },
                      required: ["word_segment_index", "word_text", "word_english", "confidence", "classification"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["candidates"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_candidates" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall?.function?.arguments) {
      throw new Error("No tool call response from AI");
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    const rawCandidates = parsed.candidates || [];

    // Map AI output back to timestamps from original segments
    const candidates: ClassifiedCandidate[] = rawCandidates.map((c: any) => {
      const wordSeg = segments[c.word_segment_index];
      const sentSeg = c.sentence_segment_index >= 0 ? segments[c.sentence_segment_index] : null;

      return {
        word_text: c.word_text || wordSeg?.text || "",
        word_english: c.word_english || "",
        word_standard: c.word_standard || undefined,
        sentence_text: c.sentence_text || sentSeg?.text || undefined,
        sentence_english: c.sentence_english || undefined,
        word_start_ms: wordSeg?.startMs ?? 0,
        word_end_ms: wordSeg?.endMs ?? 0,
        sentence_start_ms: sentSeg?.startMs ?? undefined,
        sentence_end_ms: sentSeg?.endMs ?? undefined,
        confidence: typeof c.confidence === "number" ? c.confidence : 0.5,
        classification: ["CONCRETE", "ACTION", "ABSTRACT"].includes(c.classification) ? c.classification : "ABSTRACT",
      };
    }).filter((c: ClassifiedCandidate) => c.word_text.length > 0);

    console.log(`Classified ${candidates.length} candidates from ${segments.length} segments`);

    return new Response(JSON.stringify({ success: true, candidates }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("classify-tutor-segments error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
