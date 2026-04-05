import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectVocabRules, getDialectLabel } from "../_shared/dialectHelpers.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { goal_type, goal_description, target_dialect, target_level, timeline_weeks } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const dialect = target_dialect === 'Egyptian' ? 'Egyptian' : target_dialect === 'Yemeni' ? 'Yemeni' : 'Gulf';
    const dialectLabel = getDialectLabel(dialect);
    const dialectRules = getDialectVocabRules(dialect);

    const dialectFocus = dialect === 'Egyptian'
      ? 'Focus on Egyptian Arabic dialect (Cairo, Alexandria, Upper Egypt)'
      : dialect === 'Yemeni'
      ? 'Focus on Yemeni Arabic dialect (Sana\'a, Aden, Hadramaut, Ta\'izz)'
      : 'Focus on Gulf Arabic dialect (Emirati/Saudi/Kuwaiti)';

    const systemPrompt = `You are an expert ${dialectLabel} curriculum designer. Generate a personalized week-by-week learning path.

${dialectRules}

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
    "final_outcome": "Can hold basic conversations in ${dialectLabel}",
    "key_milestones": ["Week 4: Basic conversations", "Week 8: Shopping & dining", "Week 12: Cultural discussions"]
  }
}

Rules:
- ${dialectFocus}
- Each week should have 5 daily activities
- Build progressively on previous weeks
- Include cultural context relevant to the goal
- Be practical and goal-oriented`;

    const userPrompt = `Create a ${timeline_weeks}-week ${dialectLabel} learning path for someone who wants to: ${goal_description}

Goal type: ${goal_type}
Target dialect: ${target_dialect}
Current level: ${target_level}

Make it practical and focused on their specific goal.`;

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
