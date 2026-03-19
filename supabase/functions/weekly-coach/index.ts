import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getDialectVocabRules, getDialectLabel } from "../_shared/dialectHelpers.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No auth header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { learning_path_id } = await req.json();

    // Gather user performance data
    const [
      { data: path },
      { data: xpData },
      { data: streakData },
      { data: reviewsThisWeek },
      { data: userDifficulty },
    ] = await Promise.all([
      supabase.from("learning_paths").select("*").eq("id", learning_path_id).single(),
      supabase.from("user_xp").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("review_streaks").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("word_reviews").select("id, last_result, stage").eq("user_id", user.id).gte("last_reviewed_at", new Date(Date.now() - 7 * 86400000).toISOString()),
      supabase.from("user_difficulty").select("*").eq("user_id", user.id).maybeSingle(),
    ]);

    if (!path) throw new Error("Learning path not found");

    const correctThisWeek = reviewsThisWeek?.filter(r => r.last_result === "correct").length || 0;
    const totalThisWeek = reviewsThisWeek?.length || 0;
    const accuracy = totalThisWeek > 0 ? Math.round((correctThisWeek / totalThisWeek) * 100) : 0;

    const performanceSummary = {
      xp_this_week: xpData?.xp_this_week || 0,
      current_streak: streakData?.current_streak || 0,
      reviews_this_week: totalThisWeek,
      accuracy_percent: accuracy,
      vocab_difficulty: userDifficulty?.vocab_difficulty || 0.5,
      listening_difficulty: userDifficulty?.listening_difficulty || 0.5,
      current_week: path.current_week,
      goal: path.goal_description,
    };

    // Determine difficulty adjustment
    let difficultyAdjustment = "maintain";
    if (accuracy > 85 && totalThisWeek >= 20) difficultyAdjustment = "increase";
    else if (accuracy < 60 && totalThisWeek >= 10) difficultyAdjustment = "decrease";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const prompt = `You are an encouraging Gulf Arabic (Khaliji) learning coach. Based on this student's weekly performance, provide personalized recommendations.
Use Gulf Arabic (Khaliji) dialect for all Arabic text in your response, NOT Modern Standard Arabic (فصحى). Use dialectal expressions like يالله، خوش، زين، واجد.

Performance: ${JSON.stringify(performanceSummary)}
Curriculum week ${path.current_week} of ${path.timeline_weeks}.
Goal: ${path.goal_description}

Return JSON only:
{
  "motivation_message": "Short encouraging message in English",
  "motivation_message_arabic": "Same in Gulf Arabic dialect",
  "focus_areas": ["area1", "area2"],
  "suggested_content": [
    {"type": "vocab|listening|reading|speaking|review", "title": "Activity title", "reason": "Why this helps"}
  ],
  "vocab_to_review": ["word1", "word2"],
  "difficulty_adjustment": "${difficultyAdjustment}"
}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits depleted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI gateway error");
    }

    const aiData = await aiResponse.json();
    const raw = aiData.choices?.[0]?.message?.content || "";
    let jsonStr = raw;
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1];

    const recommendations = JSON.parse(jsonStr.trim());

    // Store recommendation
    const weekStart = new Date();
    const day = weekStart.getDay();
    const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
    weekStart.setDate(diff);

    await supabase.from("weekly_recommendations").insert({
      user_id: user.id,
      learning_path_id,
      week_start: weekStart.toISOString().split("T")[0],
      performance_summary: performanceSummary,
      focus_areas: recommendations.focus_areas || [],
      suggested_content: recommendations.suggested_content || [],
      vocab_to_review: recommendations.vocab_to_review || [],
      motivation_message: recommendations.motivation_message || "",
      motivation_message_arabic: recommendations.motivation_message_arabic || "",
      difficulty_adjustment: recommendations.difficulty_adjustment || difficultyAdjustment,
    });

    // Update difficulty if needed
    if (difficultyAdjustment !== "maintain" && userDifficulty) {
      const delta = difficultyAdjustment === "increase" ? 0.1 : -0.1;
      await supabase.from("user_difficulty").update({
        vocab_difficulty: Math.max(0, Math.min(1, (userDifficulty.vocab_difficulty || 0.5) + delta)),
      }).eq("user_id", user.id);
    }

    return new Response(JSON.stringify(recommendations), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("weekly-coach error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
