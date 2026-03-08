import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// Map friendly model names to endpoint + model ID
interface ModelConfig {
  endpoint: string;
  model: string;
  keyEnv: string;
  isFanar?: boolean;
}

const RUNPOD_JAIS_ENDPOINT = "https://api.runpod.ai/v2/xx0wek543611i5/openai/v1/chat/completions";
const RUNPOD_FALCON_ENDPOINT = "https://api.runpod.ai/v2/owodjrizyv47m0/openai/v1/chat/completions";

const MODEL_REGISTRY: Record<string, ModelConfig> = {
  "google/gemini-2.5-flash": {
    endpoint: LOVABLE_GATEWAY,
    model: "google/gemini-2.5-flash",
    keyEnv: "LOVABLE_API_KEY",
  },
  "qwen/qwen3-235b-a22b": {
    endpoint: OPENROUTER_ENDPOINT,
    model: "qwen/qwen3-235b-a22b",
    keyEnv: "OPENROUTER_API_KEY",
  },
  "google/gemma-3-12b-it": {
    endpoint: OPENROUTER_ENDPOINT,
    model: "google/gemma-3-12b-it",
    keyEnv: "OPENROUTER_API_KEY",
  },
  fanar: {
    endpoint: "https://api.fanar.qa/v1/chat/completions",
    model: "Fanar",
    keyEnv: "FANAR_API_KEY",
    isFanar: true,
  },
  "jais-hf": {
    endpoint: RUNPOD_JAIS_ENDPOINT,
    model: "inceptionai/Jais-2-8B-Chat",
    keyEnv: "RUNPOD_API_KEY",
  },
  "falcon-h1r": {
    endpoint: RUNPOD_FALCON_ENDPOINT,
    model: "tiiuae/Falcon-H1R-7B",
    keyEnv: "RUNPOD_API_KEY",
  },
};

const DIALECT_CONTEXT: Record<string, string> = {
  Gulf: "general Gulf Arabic (Khaleeji) — covering shared vocabulary and grammar across all six GCC states",
  Saudi: "Saudi Arabian Arabic — Najdi and Hejazi dialects, using Saudi-specific vocabulary (e.g., إيش for 'what', وش for 'what' in Najdi)",
  Kuwaiti: "Kuwaiti Arabic — using Kuwaiti-specific vocabulary (e.g., شنو for 'what', شلونك for 'how are you')",
  Emirati: "Emirati Arabic — UAE dialect with Emirati-specific vocabulary (e.g., شحالك for 'how are you', هيه for 'yes')",
  Bahraini: "Bahraini Arabic — using Bahraini-specific expressions and pronunciation patterns",
  Qatari: "Qatari Arabic — using Qatari-specific vocabulary and expressions",
  Omani: "Omani Arabic — using Omani-specific vocabulary and expressions, noting regional variations within Oman",
};

function buildSystemPrompt(
  dialect: string,
  stageContext?: { name?: string; cefr?: string },
  mode?: string,
): string {
  const dialectDesc = DIALECT_CONTEXT[dialect] || DIALECT_CONTEXT["Gulf"];
  const stageInfo = stageContext?.name
    ? `\nThe admin is building content for: Stage "${stageContext.name}" (CEFR: ${stageContext.cefr || "unspecified"}).`
    : "";

  let modeInstructions = "";
  if (mode === "generate_lesson") {
    modeInstructions = `

IMPORTANT: The admin wants you to generate a structured lesson. Along with your conversational explanation, you MUST include a JSON code block with this exact schema:

\`\`\`json
{
  "type": "lesson_preview",
  "lesson": {
    "title": "Lesson title in English",
    "title_arabic": "عنوان الدرس",
    "description": "Brief description of what students will learn",
    "duration_minutes": 20,
    "cefr_target": "A1",
    "approach": "How this lesson teaches (e.g. dialogues, flashcards, real-world scenarios)",
    "icon": "📚",
    "vocabulary": [
      {
        "word_arabic": "كلمة",
        "word_english": "word",
        "transliteration": "kilma",
        "category": "noun|verb|adjective|phrase|expression",
        "teaching_note": "Optional note about usage or dialect variation",
        "image_scene_description": "A brief scene description for AI image generation (for concrete/action words)"
      }
    ],
    "cultural_notes": "Cultural context relevant to this lesson",
    "dialect_notes": "How this content varies across Gulf countries"
  }
}
\`\`\``;
  } else if (mode === "generate_vocab") {
    modeInstructions = `

IMPORTANT: The admin wants vocabulary words. Along with your conversational explanation, you MUST include a JSON code block with this exact schema:

\`\`\`json
{
  "type": "vocab_preview",
  "vocabulary": [
    {
      "word_arabic": "كلمة",
      "word_english": "word",
      "transliteration": "kilma",
      "category": "noun|verb|adjective|phrase|expression",
      "teaching_note": "Optional note about usage or dialect variation",
      "image_scene_description": "A brief scene description for AI image generation"
    }
  ],
  "dialect_notes": "How these words vary across Gulf countries"
}
\`\`\``;
  }

  return `You are an expert Gulf Arabic curriculum designer and language teacher. You are helping an admin build lessons and vocabulary for "Lahja" (لهجة), a Gulf Arabic learning app.

Target dialect: ${dialectDesc}
${stageInfo}

The Lahja curriculum has 6 stages:
1. Foundations (Pre-A1 → A1): 50+ survival phrases, Arabic script, Gulf sounds. 4–6 weeks.
2. Building Blocks (A1 → A2): Basic sentences, slow Gulf speech, 500+ words. 8–12 weeks.
3. The Bridge (A2 → B1): Authentic content with scaffolding, familiar topics, 1,500+ words. 8–16 weeks.
4. Immersion (B1 → B2): Primary learning through authentic content, opinions, 3,000+ words. 12–20 weeks.
5. Fluency (B2 → C1): Complex discussions, rapid speech, slang, 5,000+ words. 16–24 weeks.
6. Mastery (C1 → C2): Near-native comprehension, cultural fluency, register shifting. Ongoing.

Guidelines:
- Always use the target dialect's vocabulary and expressions, NOT Modern Standard Arabic (unless explicitly asked).
- Include transliterations that are easy for English speakers to read.
- Note when a word/phrase differs significantly between Gulf countries.
- Provide cultural context and usage notes where helpful.
- Organize vocabulary by practical categories (greetings, food, directions, etc.).
- For each vocabulary word, suggest a category: noun, verb, adjective, phrase, or expression.
- Be creative and practical — focus on what learners actually need in real Gulf conversations.
${modeInstructions}`;
}

async function callLLM(
  config: ModelConfig,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 4096,
): Promise<string> {
  const apiKey = Deno.env.get(config.keyEnv)?.trim();
  if (!apiKey) {
    throw new Error(`API key ${config.keyEnv} not configured`);
  }

  let endpoint = config.endpoint;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 402) {
        throw new Error("Not enough AI credits. Please add credits to your workspace.");
      }
      if (response.status === 429) {
        throw new Error("Rate limit exceeded. Please wait a moment and try again.");
      }
      throw new Error(`LLM ${config.model} error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`LLM ${config.model} returned empty response`);
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

/** Try to extract structured JSON from a response that mixes markdown + JSON code blocks. */
function extractStructuredOutput(content: string): {
  type: string;
  data: Record<string, unknown>;
} | null {
  // Look for ```json ... ``` blocks
  const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)```/);
  if (!jsonBlockMatch) return null;

  try {
    const parsed = JSON.parse(jsonBlockMatch[1].trim());
    if (parsed && typeof parsed === "object" && parsed.type) {
      return { type: parsed.type, data: parsed };
    }
    return null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Authenticate — admin only
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check admin role
    const { data: roles } = await supabaseAuth
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const isAdmin = roles?.some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const {
      messages,
      model: modelId,
      dialect = "Gulf",
      stage_context: stageContext,
      mode = "chat",
    } = body as {
      messages: Array<{ role: string; content: string }>;
      model: string;
      dialect?: string;
      stage_context?: { name?: string; cefr?: string };
      mode?: string;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const config = MODEL_REGISTRY[modelId];
    if (!config) {
      return new Response(
        JSON.stringify({
          error: `Unknown model: ${modelId}. Available: ${Object.keys(MODEL_REGISTRY).join(", ")}`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build the full message array with system prompt (cap history to avoid token overflow)
    const cappedMessages = messages.slice(-50);
    const systemPrompt = buildSystemPrompt(dialect, stageContext, mode);
    const fullMessages = [
      { role: "system", content: systemPrompt },
      ...cappedMessages.map((m) => ({ role: m.role, content: m.content })),
    ];

    console.log(
      `curriculum-chat: model=${modelId} dialect=${dialect} mode=${mode} msgs=${messages.length}`,
    );

    const responseContent = await callLLM(config, fullMessages, 4096);

    // Try to extract structured output
    const structured = extractStructuredOutput(responseContent);

    // Log usage
    try {
      const supabaseService = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await supabaseService.from("llm_usage_logs").insert({
        function_name: "curriculum-chat",
        llm_used: modelId,
        phrase: `[curriculum-chat] mode=${mode} dialect=${dialect} messages=${messages.length}`,
        user_id: user.id,
      });
    } catch (logErr) {
      console.warn("Failed to log LLM usage:", logErr);
    }

    return new Response(
      JSON.stringify({
        content: responseContent,
        model: modelId,
        structured_output: structured?.data ?? null,
        output_type: structured?.type ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("curriculum-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
