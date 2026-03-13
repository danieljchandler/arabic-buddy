import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

interface ModelConfig {
  endpoint: string;
  model: string;
  keyEnv: string;
  isFanar?: boolean;
  native?: boolean; // true = native RunPod /runsync API
}

const JAIS_HF_ENDPOINT = "https://u1lf1x17ye91ruw5.us-east-1.aws.endpoints.huggingface.cloud/v1/chat/completions";

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
    endpoint: JAIS_HF_ENDPOINT,
    model: "inceptionai/jais-13b-chat",
    keyEnv: "VITE_HF_TOKEN",
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

// ─── MODE-SPECIFIC JSON SCHEMAS ─────────────────────────

const MODE_INSTRUCTIONS: Record<string, string> = {
  generate_lesson: `
IMPORTANT: Generate a structured lesson. Include a JSON code block:

\`\`\`json
{
  "type": "lesson_preview",
  "lesson": {
    "title": "Lesson title in English",
    "title_arabic": "عنوان الدرس",
    "description": "Brief description",
    "duration_minutes": 20,
    "cefr_target": "A1",
    "approach": "Teaching approach",
    "icon": "📚",
    "vocabulary": [
      { "word_arabic": "كلمة", "word_english": "word", "transliteration": "kilma", "category": "noun", "teaching_note": "", "image_scene_description": "" }
    ],
    "cultural_notes": "Cultural context",
    "dialect_notes": "Dialect variations"
  }
}
\`\`\``,

  generate_vocab: `
IMPORTANT: Generate vocabulary words. Include a JSON code block:

\`\`\`json
{
  "type": "vocab_preview",
  "vocabulary": [
    { "word_arabic": "كلمة", "word_english": "word", "transliteration": "kilma", "category": "noun", "teaching_note": "", "image_scene_description": "" }
  ],
  "dialect_notes": "How these words vary across Gulf countries"
}
\`\`\``,

  generate_grammar: `
IMPORTANT: Generate grammar drill exercises. Include a JSON code block with 5-10 questions:

\`\`\`json
{
  "type": "grammar_preview",
  "category": "verb-conjugation|pronouns|negation|possessives|questions|sentence-structure",
  "difficulty": "beginner|intermediate|advanced",
  "exercises": [
    {
      "question_arabic": "اختر الإجابة الصحيحة: أنا ___ إلى السوق",
      "question_english": "Choose the correct answer: I ___ to the market",
      "grammar_point": "verb conjugation - past tense",
      "choices": [
        { "text_arabic": "رحت", "text_english": "I went" },
        { "text_arabic": "راح", "text_english": "He went" },
        { "text_arabic": "رحنا", "text_english": "We went" },
        { "text_arabic": "رحتي", "text_english": "You (f) went" }
      ],
      "correct_index": 0,
      "explanation": "For 'I' (أنا) in past tense, we use رحت (ruht)"
    }
  ]
}
\`\`\``,

  generate_listening: `
IMPORTANT: Generate listening exercise content. Include a JSON code block with 3-5 exercises:

\`\`\`json
{
  "type": "listening_preview",
  "mode": "dictation|comprehension|speed",
  "difficulty": "beginner|intermediate|advanced",
  "exercises": [
    {
      "audio_text": "وين تبي تروح اليوم؟",
      "audio_text_english": "Where do you want to go today?",
      "hint": "A question about plans",
      "options": [
        { "text": "He's asking about your destination", "textArabic": "يسأل عن وجهتك", "correct": true },
        { "text": "He's asking about food", "textArabic": "يسأل عن الأكل", "correct": false },
        { "text": "He's asking about the weather", "textArabic": "يسأل عن الطقس", "correct": false }
      ]
    }
  ]
}
\`\`\``,

  generate_reading: `
IMPORTANT: Generate a reading passage with comprehension questions. Include a JSON code block:

\`\`\`json
{
  "type": "reading_preview",
  "difficulty": "beginner|intermediate|advanced",
  "passage": {
    "title": "عنوان القصة",
    "title_english": "Story Title",
    "passage": "النص العربي الكامل...",
    "passage_english": "Full English translation...",
    "vocabulary": [
      { "arabic": "كلمة", "english": "word", "inContext": "الكلمة في جملة" }
    ],
    "questions": [
      {
        "question": "سؤال بالعربي؟",
        "questionEnglish": "Question in English?",
        "options": [
          { "text": "إجابة ١", "textEnglish": "Answer 1", "correct": true },
          { "text": "إجابة ٢", "textEnglish": "Answer 2", "correct": false }
        ]
      }
    ],
    "cultural_note": "Cultural context about the passage"
  }
}
\`\`\``,

  generate_daily_challenge: `
IMPORTANT: Generate a daily challenge set with mixed question types. Include a JSON code block:

\`\`\`json
{
  "type": "daily_challenge_preview",
  "challenge_type": "vocab|grammar|mixed",
  "difficulty": "beginner|intermediate|advanced",
  "title": "Challenge Title",
  "title_arabic": "عنوان التحدي",
  "questions": [
    {
      "type": "translate",
      "prompt": "How do you say 'hello' in Gulf Arabic?",
      "answer": "هلا",
      "options": ["هلا", "مرحبا", "سلام", "أهلاً"],
      "hint": "Common informal greeting"
    },
    {
      "type": "fill-blank",
      "sentence": "أنا ___ من الكويت",
      "sentenceEnglish": "I am ___ from Kuwait",
      "answer": "أكون",
      "hint": "verb 'to be'"
    },
    {
      "type": "unscramble",
      "scrambled": "السوق إلى رحت",
      "answer": "رحت إلى السوق",
      "hint": "I went to the market"
    }
  ]
}
\`\`\``,

  generate_conversation: `
IMPORTANT: Generate a conversation scenario for practice. Include a JSON code block:

\`\`\`json
{
  "type": "conversation_preview",
  "scenario": {
    "title": "Scenario Title",
    "title_arabic": "عنوان السيناريو",
    "description": "Brief description of the scenario",
    "difficulty": "Beginner|Intermediate|Advanced",
    "icon_name": "Coffee|MapPin|ShoppingBag|Users|UtensilsCrossed|Building2|Stethoscope|Phone|Plane|MessageCircle",
    "system_prompt": "You are a [role] at [location]. Speak ONLY in Gulf Arabic ([dialect] dialect). Keep responses short (1-2 sentences). Start by [opening]. After each Arabic response, add a line break then provide the English translation in parentheses.",
    "example_exchanges": [
      { "role": "assistant", "content": "هلا والله! شلونك؟\n(Hello! How are you?)" },
      { "role": "user", "content": "الحمد لله بخير" }
    ]
  }
}
\`\`\``,

  generate_game_set: `
IMPORTANT: Generate a vocabulary game set with word pairs. Include a JSON code block:

\`\`\`json
{
  "type": "game_set_preview",
  "game_type": "matching|memory|fill-blank",
  "title": "Game Set Title",
  "difficulty": "beginner|intermediate|advanced",
  "word_pairs": [
    { "word_arabic": "كتاب", "word_english": "book" },
    { "word_arabic": "قلم", "word_english": "pen" }
  ]
}
\`\`\``,
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

  const modeInstructions = mode && MODE_INSTRUCTIONS[mode] ? MODE_INSTRUCTIONS[mode] : "";

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  try {
    let body: string;
    if (config.native) {
      // Native RunPod /runsync API — format messages into a single prompt
      const systemMsg = messages.find(m => m.role === 'system')?.content || '';
      const userMsgs = messages.filter(m => m.role !== 'system').map(m => `${m.role}: ${m.content}`).join('\n');
      body = JSON.stringify({
        input: {
          prompt: `### Instruction: ${systemMsg}\n\n### Input: ${userMsgs}\n\n### Response:`,
        },
      });
    } else {
      const payload: Record<string, unknown> = {
        model: config.model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.4,
      };
      // Jais HF endpoint requires explicit chat_template (transformers v4.44+)
      if (config.model === 'inceptionai/jais-13b-chat') {
        payload.chat_template = "{% for message in messages %}{% if message['role'] == 'user' %}### Instruction: Your name is Jais, and you are named after Jebel Jais, the highest mountain in UAE. You are helpful, respectful, and honest.\n[|Human|]: {{ message['content'] }}\n[|AI|]:{% elif message['role'] == 'assistant' %} {{ message['content'] }}{% endif %}{% endfor %}";
      }
      body = JSON.stringify(payload);
    }

    const response = await fetch(config.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
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
    let content: string | undefined;
    if (config.native) {
      content = typeof data.output === 'string' ? data.output : data.output?.text ?? data.output?.choices?.[0]?.message?.content;
    } else {
      content = data.choices?.[0]?.message?.content;
    }
    if (!content) {
      throw new Error(`LLM ${config.model} returned empty response`);
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

function extractStructuredOutput(content: string): {
  type: string;
  data: Record<string, unknown>;
} | null {
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
    const structured = extractStructuredOutput(responseContent);

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
