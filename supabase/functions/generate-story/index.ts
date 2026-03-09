import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, dialect, difficulty, sceneCount, guidance } = await req.json();

    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("generate-story: LOVABLE_API_KEY not configured");
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const numScenes = Math.max(3, Math.min(10, sceneCount || 5));
    const targetDialect = dialect || "Gulf";
    const targetDifficulty = difficulty || "Beginner";

    // Build a scene index plan description for the AI
    // e.g. 5 scenes: scenes 0-3 are story scenes, scene 4 is ending
    // For branching: scenes 0, 1, 2 branch to different paths; scenes 3,4 converge
    const systemPrompt = `You are an expert Arabic language teacher creating interactive branching stories to teach ${targetDialect} Arabic dialect at a ${targetDifficulty} level.

You will generate a complete interactive story with exactly ${numScenes} scenes (numbered 0 to ${numScenes - 1}).

Story structure rules:
- Scene 0 is always the opening scene
- The LAST scene (scene ${numScenes - 1}) MUST be an ending scene (is_ending: true)
- At least one other scene should also be an ending (for alternate endings)
- Each non-ending scene must have 2-3 choices that lead to different scene numbers
- Choices must reference valid scene numbers (0 to ${numScenes - 1})
- Avoid circular references that trap the player
- The story should naturally lead toward the ending(s)

Language rules for ${targetDialect} Arabic at ${targetDifficulty} level:
- Use authentic ${targetDialect} dialect expressions and vocabulary
- For Beginner: simple sentences, common everyday vocabulary, short narratives
- For Intermediate: more complex sentences, colloquial expressions, cultural references
- For Advanced: idiomatic expressions, complex grammar, rich cultural context
- Always provide accurate English translations
- Each scene should teach 2-4 vocabulary words

${guidance ? `Additional guidance from the author:\n${guidance}` : ""}

You MUST call the generate_story function with your complete response. Do not include any text outside the function call.`;

    const userPrompt = `Create an interactive ${targetDialect} Arabic story about: ${prompt}

The story should have ${numScenes} scenes. Make the narrative engaging and educational. Each scene should immerse the learner in a realistic ${targetDialect} cultural context. The choices should feel natural and meaningful, not arbitrary.`;

    const toolSchema = {
      type: "function",
      function: {
        name: "generate_story",
        description: "Generate a complete interactive Arabic story with scenes and choices",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Story title in English (catchy, descriptive)",
            },
            title_arabic: {
              type: "string",
              description: `Story title in ${targetDialect} Arabic`,
            },
            description: {
              type: "string",
              description: "1-2 sentence description of the story in English",
            },
            description_arabic: {
              type: "string",
              description: `1-2 sentence description of the story in ${targetDialect} Arabic`,
            },
            scenes: {
              type: "array",
              description: `Array of exactly ${numScenes} scenes`,
              items: {
                type: "object",
                properties: {
                  scene_order: {
                    type: "number",
                    description: "Scene index starting from 0",
                  },
                  narrative_arabic: {
                    type: "string",
                    description: `The scene narrative text in ${targetDialect} Arabic (2-4 sentences)`,
                  },
                  narrative_english: {
                    type: "string",
                    description: "English translation of the narrative (2-4 sentences)",
                  },
                  vocabulary: {
                    type: "array",
                    description: "2-4 key vocabulary words from this scene",
                    items: {
                      type: "object",
                      properties: {
                        word_arabic: { type: "string" },
                        word_english: { type: "string" },
                      },
                      required: ["word_arabic", "word_english"],
                      additionalProperties: false,
                    },
                  },
                  is_ending: {
                    type: "boolean",
                    description: "True if this is an ending scene (no choices needed)",
                  },
                  choices: {
                    type: "array",
                    description: "2-3 choices for non-ending scenes (empty array for ending scenes)",
                    items: {
                      type: "object",
                      properties: {
                        text_arabic: {
                          type: "string",
                          description: "Choice text in Arabic (short, 1 sentence)",
                        },
                        text_english: {
                          type: "string",
                          description: "Choice text in English (short, 1 sentence)",
                        },
                        next_scene_order: {
                          type: "number",
                          description: `Scene number to go to (must be between 1 and ${numScenes - 1})`,
                        },
                      },
                      required: ["text_arabic", "text_english", "next_scene_order"],
                      additionalProperties: false,
                    },
                  },
                  ending_message: {
                    type: "string",
                    description: "Congratulatory message in English for ending scenes (null for non-endings)",
                  },
                  ending_message_arabic: {
                    type: "string",
                    description: "Congratulatory message in Arabic for ending scenes (null for non-endings)",
                  },
                },
                required: [
                  "scene_order",
                  "narrative_arabic",
                  "narrative_english",
                  "vocabulary",
                  "is_ending",
                  "choices",
                  "ending_message",
                  "ending_message_arabic",
                ],
                additionalProperties: false,
              },
            },
          },
          required: ["title", "title_arabic", "description", "description_arabic", "scenes"],
          additionalProperties: false,
        },
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    let response: Response;
    try {
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [toolSchema],
          tool_choice: { type: "function", function: { name: "generate_story" } },
          max_tokens: 4000,
          temperature: 0.8,
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("generate-story: AI gateway error", response.status, errorText.slice(0, 300));

      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Not enough AI credits. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please wait a moment and try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: `AI service returned ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();

    // Extract the tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function?.name !== "generate_story") {
      console.error("generate-story: unexpected response shape", JSON.stringify(data).slice(0, 300));
      return new Response(JSON.stringify({ error: "AI did not return a valid story" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let story: unknown;
    try {
      story = JSON.parse(toolCall.function.arguments);
    } catch (parseErr) {
      console.error("generate-story: failed to parse tool args", parseErr);
      return new Response(JSON.stringify({ error: "Failed to parse AI response" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ story }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("generate-story: unhandled error", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
