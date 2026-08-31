import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";
import { chatFetch, hasAnyProvider } from "../_shared/aiGateway.ts";
import { enforceAnonymousDailyCap, resolveUserId } from "../_shared/usageCap.ts";
import { normalizeDialect } from "../_shared/transcriptDiffCore.ts";

// Service-role client for the placement_history trajectory, cached per
// isolate like every other function's.
let cachedHistoryClient: ReturnType<typeof createClient> | null = null;
function historyClient() {
  if (!cachedHistoryClient) {
    cachedHistoryClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return cachedHistoryClient;
}


const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

function adjustDifficulty(history: { correct: boolean; difficulty: string }[]): string {
  if (history.length === 0) return "B1";
  const lastFive = history.slice(-5);
  const correctCount = lastFive.filter((h) => h.correct).length;
  const currentIdx = CEFR_LEVELS.indexOf(lastFive[lastFive.length - 1].difficulty);
  if (correctCount >= 4 && currentIdx < CEFR_LEVELS.length - 1) return CEFR_LEVELS[currentIdx + 1];
  if (correctCount <= 1 && currentIdx > 0) return CEFR_LEVELS[currentIdx - 1];
  return CEFR_LEVELS[Math.max(0, currentIdx)];
}

/**
 * Placement from the bands the learner actually sustained.
 *
 * The old scoring mapped an overall difficulty-weighted percentage through
 * fixed cutoffs, so a learner who answered 85%+ of *B1-and-easier* questions
 * correctly was placed at C2 despite never seeing a C1 question. Placement
 * anchors i+1 content selection everywhere (Discover's default filter,
 * grammar difficulty), so over-placement put every downstream surface above
 * the learner's head.
 *
 * Now: the level is the highest band the learner *attempted* and answered at
 * ≥65% — the adaptive walk already spends its questions finding that
 * frontier — with a single answer never counting as evidence on its own (the
 * walk can end one question after moving up a band). A learner who sustains
 * no attempted band lands one below the lowest they tried. The level can
 * never exceed the hardest question actually asked.
 */
const SUSTAINED_ACCURACY = 0.65;

function calculateCEFR(history: { correct: boolean; difficulty: string; skill_type: string }[]): {
  cefr_level: string;
  confidence: number;
  strengths: string[];
  weaknesses: string[];
} {
  const skillScores: Record<string, { correct: number; total: number }> = {};
  const bandScores: Record<string, { correct: number; total: number }> = {};

  for (const h of history) {
    if (!skillScores[h.skill_type]) skillScores[h.skill_type] = { correct: 0, total: 0 };
    skillScores[h.skill_type].total++;
    if (h.correct) skillScores[h.skill_type].correct++;

    if (!bandScores[h.difficulty]) bandScores[h.difficulty] = { correct: 0, total: 0 };
    bandScores[h.difficulty].total++;
    if (h.correct) bandScores[h.difficulty].correct++;
  }

  const attempted = CEFR_LEVELS
    .map((level, idx) => ({ level, idx, score: bandScores[level] }))
    .filter((b) => b.score && b.score.total > 0);

  let levelIdx = 0;
  let confidence = 0;
  if (attempted.length > 0) {
    let placed: { idx: number; accuracy: number } | null = null;
    for (let i = attempted.length - 1; i >= 0; i--) {
      const band = attempted[i];
      const accuracy = band.score!.correct / band.score!.total;
      if (band.score!.total >= 2 && accuracy >= SUSTAINED_ACCURACY) {
        placed = { idx: band.idx, accuracy };
        break;
      }
    }
    if (placed) {
      levelIdx = placed.idx;
      confidence = placed.accuracy;
    } else {
      // Nothing sustained. Near-misses at the lowest band tried land one step
      // below it; a collapse (under 35%) is no evidence of the neighbouring
      // band either and goes to the floor.
      const lowest = attempted[0];
      const accuracy = lowest.score!.correct / lowest.score!.total;
      levelIdx = accuracy >= 0.35 ? Math.max(0, lowest.idx - 1) : 0;
      confidence = accuracy;
    }
  }

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  for (const [skill, scores] of Object.entries(skillScores)) {
    const pct = scores.correct / scores.total;
    if (pct >= 0.7) strengths.push(skill);
    else if (pct < 0.4) weaknesses.push(skill);
  }

  return {
    cefr_level: CEFR_LEVELS[levelIdx],
    confidence: Math.round(confidence * 100),
    strengths: strengths.length ? strengths : ["general_comprehension"],
    weaknesses: weaknesses.length ? weaknesses : [],
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, current_difficulty, question_number, history, dialect } = await req.json();
    if (!hasAnyProvider()) throw new Error("No AI provider configured");

    // Every generate/score action is a model call, and this endpoint is
    // reachable with just the anon key — it was unlimited spend for anyone
    // holding the JS bundle. A 20-question run is ~5 generates + 1 score, so
    // 40/day leaves room for several full runs, per account or per IP.
    if (action === "generate" || action === "score") {
      const cap = await enforceAnonymousDailyCap(req, "placement-quiz", 40, corsHeaders);
      if (cap.limited) return cap.response;
    }

    // The learner's assessment trajectory (C4) — server-written rows only,
    // so the chart can't be self-reported.
    if (action === "history") {
      const userId = await resolveUserId(req);
      if (!userId) {
        return new Response(JSON.stringify({ error: "auth_required" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: rows, error: historyErr } = await historyClient()
        .from("placement_history")
        .select("dialect, cefr_level, confidence, taken_at")
        .eq("user_id", userId)
        .order("taken_at", { ascending: true })
        .limit(100);
      if (historyErr) {
        return new Response(JSON.stringify({ error: historyErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ history: rows ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Score action — no AI needed
    if (action === "score") {
      const result = calculateCEFR(history || []);
      // Append the trajectory row (fire-and-forget: scoring must not fail on
      // bookkeeping). Anonymous callers simply record nothing.
      try {
        const userId = await resolveUserId(req);
        const scoredDialect = normalizeDialect(dialect);
        if (userId && scoredDialect) {
          historyClient()
            .from("placement_history")
            .insert([
              {
                user_id: userId,
                dialect: scoredDialect,
                cefr_level: result.cefr_level,
                confidence: Math.max(0, Math.min(100, Math.round(result.confidence ?? 0))),
              },
            ] as unknown as never)
            .then(
              ({ error }: { error: { message: string } | null }) => {
                if (error) console.warn("[placement-quiz] history insert failed:", error.message);
              },
              (err: unknown) => console.warn("[placement-quiz] history insert threw:", err),
            );
        }
      } catch (e) {
        console.warn("[placement-quiz] history record failed:", e);
      }
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate questions
    const difficulty = current_difficulty || adjustDifficulty(history || []);
    const batchNum = Math.floor((question_number || 0) / 5) + 1;
    const dialectName = dialect || "Gulf";

    const historyStr =
      history && history.length > 0
        ? `Previous performance: ${history.filter((h: any) => h.correct).length}/${history.length} correct. `
        : "";

    const prompt = `You are an Arabic language placement test generator for ${dialectName} Arabic dialect.

${historyStr}Generate exactly 5 multiple-choice questions at CEFR level ${difficulty} (batch ${batchNum}/4).

Mix these question types across the 5 questions:
- vocabulary: Match a word to its meaning (show Arabic word, English choices or vice versa)
- grammar: Fill-in-the-blank or choose correct form
- reading: Short Arabic sentence/passage with comprehension question
- translation: Translate a short phrase
- listening: A short spoken line. question_arabic is the line EXACTLY as it should be
  heard and nothing else — no instructions, no English, no quotation marks — because
  the app speaks it aloud and never shows it. The choices are English meanings.

IMPORTANT RULES:
- Use authentic ${dialectName} Arabic, NOT Modern Standard Arabic (MSA)
- Each question must have exactly 4 choices
- Vary the skill types across the batch
- Include at least one listening question in every batch. This is a spoken-dialect
  test: a placement built only from reading over-places anyone whose ear lags their eye
- Make difficulty appropriate for ${difficulty} level
- Include diacritics (tashkeel) for A1-A2 level questions

Return a JSON object with this exact structure:
{
  "questions": [
    {
      "question_arabic": "the question prompt in Arabic",
      "question_english": "the question prompt in English",
      "skill_type": "vocabulary|grammar|reading|translation|listening",
      "difficulty": "${difficulty}",
      "choices": [
        {"text": "choice 1", "text_arabic": "الخيار ١"},
        {"text": "choice 2", "text_arabic": "الخيار ٢"},
        {"text": "choice 3", "text_arabic": "الخيار ٣"},
        {"text": "choice 4", "text_arabic": "الخيار ٤"}
      ],
      "correct_index": 0
    }
  ],
  "suggested_difficulty": "${difficulty}"
}`;

    const response = await chatFetch(MODEL_IDS.GEMINI_FAST, {
        messages: [
          { role: "system", content: "You are a precise Arabic language assessment tool. Always respond with valid JSON only, no markdown fences." },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "placement_questions",
              description: "Return placement quiz questions",
              parameters: {
                type: "object",
                properties: {
                  questions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        question_arabic: { type: "string" },
                        question_english: { type: "string" },
                        skill_type: { type: "string", enum: ["vocabulary", "grammar", "reading", "translation", "listening"] },
                        difficulty: { type: "string" },
                        choices: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              text: { type: "string" },
                              text_arabic: { type: "string" },
                            },
                            required: ["text", "text_arabic"],
                          },
                        },
                        correct_index: { type: "number" },
                      },
                      required: ["question_arabic", "question_english", "skill_type", "difficulty", "choices", "correct_index"],
                    },
                  },
                  suggested_difficulty: { type: "string" },
                },
                required: ["questions", "suggested_difficulty"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "placement_questions" } },
    }, { label: "placement-quiz" });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error("AI gateway error");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: any;

    if (toolCall?.function?.arguments) {
      parsed = typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;
    } else {
      // Fallback: try parsing content directly
      const content = aiResult.choices?.[0]?.message?.content || "";
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    }

    // Validate we got questions
    if (!parsed?.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      throw new Error("Invalid response structure from AI");
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("placement-quiz error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
