import { getDialectVocabRules, getDialectLabel } from "../_shared/dialectHelpers.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// CEFR level descriptions for curriculum calibration
const CEFR_GUIDANCE: Record<string, string> = {
  A1: `The learner is CEFR A1 (Beginner). They know very little Arabic.
- Start with: alphabet recognition, basic greetings, numbers 1-10, simple self-introduction
- Vocabulary: 50-100 high-frequency words over the course
- Grammar: basic pronouns, simple present tense, yes/no questions
- Activities should be heavily scaffolded with transliteration and English support`,

  A2: `The learner is CEFR A2 (Elementary). They know basic phrases and simple sentences.
- Start with: expanding greetings, daily routines, shopping phrases, directions
- Vocabulary: 150-300 words, build on existing basics
- Grammar: past tense, negation, possessives, prepositions
- Can handle short dialogues and simple reading passages`,

  B1: `The learner is CEFR B1 (Intermediate). They can handle familiar everyday situations.
- Start with: expressing opinions, narrating events, discussing plans
- Vocabulary: 300-500 words, including abstract concepts
- Grammar: future tense, conditionals, relative clauses, verb forms
- Can handle longer conversations, news articles, and short stories`,

  B2: `The learner is CEFR B2 (Upper Intermediate). They can interact with fluency.
- Start with: debating topics, understanding media, professional communication
- Vocabulary: 500+ words, idiomatic expressions, formal/informal register
- Grammar: subjunctive mood, complex sentence structures, rhetorical devices
- Should include authentic materials: news, podcasts, social media`,

  C1: `The learner is CEFR C1 (Advanced). They can express themselves fluently and spontaneously.
- Focus on: nuanced expression, humor, sarcasm, cultural subtleties
- Vocabulary: rare words, proverbs, poetry vocabulary, specialized terminology
- Grammar: advanced rhetoric, stylistic variation, dialect vs MSA awareness
- Use authentic unscripted materials, debates, literature`,

  C2: `The learner is CEFR C2 (Near Native). They can understand virtually everything.
- Focus on: mastery of register switching, dialectal nuances across sub-dialects
- Vocabulary: specialized, literary, archaic, and slang
- Activities: translation exercises, creative writing, critical analysis
- Content should challenge even native speakers`,
};

const LEVEL_TO_CEFR: Record<string, string> = {
  complete_beginner: "A1",
  some_basics: "A2",
  elementary: "B1",
  conversational: "B2",
  advanced: "C1",
  near_native: "C2",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { goal_type, goal_description, target_dialect, target_level, timeline_weeks, placement_level } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const dialect = target_dialect === 'Egyptian' ? 'Egyptian' : target_dialect === 'Yemeni' ? 'Yemeni' : 'Gulf';
    const dialectLabel = getDialectLabel(dialect);
    const dialectRules = getDialectVocabRules(dialect);

    // Determine CEFR level from placement test or mapped from target_level
    const cefrLevel = placement_level || LEVEL_TO_CEFR[target_level] || "A1";
    const cefrGuidance = CEFR_GUIDANCE[cefrLevel] || CEFR_GUIDANCE["A1"];

    const dialectFocus = dialect === 'Egyptian'
      ? 'Focus on Egyptian Arabic dialect (Cairo, Alexandria, Upper Egypt)'
      : dialect === 'Yemeni'
      ? 'Focus on Yemeni Arabic dialect (Sana\'a, Aden, Hadramaut, Ta\'izz)'
      : 'Focus on Gulf Arabic dialect (Emirati/Saudi/Kuwaiti)';

    const systemPrompt = `You are an expert ${dialectLabel} curriculum designer. Generate a personalized week-by-week learning path.

${dialectRules}

LEARNER PROFICIENCY (CRITICAL — calibrate ALL content to this level):
${cefrGuidance}

Return a JSON object with this exact structure (no markdown, just raw JSON):
{
  "curriculum": [
    {
      "week": 1,
      "theme": "Greetings & Introductions",
      "theme_arabic": "التحيات والتعارف",
      "vocab_targets": ["hello", "goodbye", "how are you"],
      "grammar_focus": "Basic sentence structure",
      "activities": [
        {"day": 1, "type": "vocab", "description": "Learn 5 greeting phrases"},
        {"day": 2, "type": "listening", "description": "Listen to greetings dialogue"},
        {"day": 3, "type": "speaking", "description": "Practice pronunciation"},
        {"day": 4, "type": "reading", "description": "Read short greeting texts"},
        {"day": 5, "type": "review", "description": "Review all week's content"}
      ],
      "milestone": "Can greet people in ${dialectLabel}"
    }
  ],
  "overview": {
    "total_vocab_target": 200,
    "starting_cefr": "${cefrLevel}",
    "target_cefr": "${getTargetCefr(cefrLevel, timeline_weeks)}",
    "final_outcome": "Can hold basic conversations in ${dialectLabel}",
    "key_milestones": ["Week 4: Basic conversations", "Week 8: Shopping & dining", "Week 12: Cultural discussions"]
  }
}

Rules:
- ${dialectFocus}
- The starting difficulty MUST match the learner's CEFR ${cefrLevel} level — do NOT start from scratch if they are intermediate or above
- Each week should have 5 daily activities
- Build progressively on previous weeks
- Include cultural context relevant to the goal
- Be practical and goal-oriented
- For ${cefrLevel} learners, skip content they already know and focus on their growth areas`;

    const userPrompt = `Create a ${timeline_weeks}-week ${dialectLabel} learning path for a ${cefrLevel}-level learner who wants to: ${goal_description}

Goal type: ${goal_type}
Target dialect: ${target_dialect}
Current CEFR level: ${cefrLevel}
Self-assessed level: ${target_level}

IMPORTANT: Start the curriculum at ${cefrLevel} level. Do NOT include beginner content if the learner is intermediate or above. Make it practical and focused on their specific goal.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits depleted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", status, t);
      throw new Error("AI gateway error");
    }

    const aiData = await response.json();
    const raw = aiData.choices?.[0]?.message?.content || "";
    
    // Extract JSON from possible markdown code blocks
    let jsonStr = raw;
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1];
    
    const curriculum = JSON.parse(jsonStr.trim());

    return new Response(JSON.stringify(curriculum), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-learning-path error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function getTargetCefr(current: string, weeks: number): string {
  const levels = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const idx = levels.indexOf(current);
  if (idx === -1) return "B1";
  // Estimate: ~12 weeks per CEFR level advancement
  const advancement = Math.min(Math.floor(weeks / 10), levels.length - 1 - idx);
  return levels[idx + Math.max(advancement, 1)] || levels[levels.length - 1];
}
