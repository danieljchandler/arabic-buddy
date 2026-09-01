/**
 * monologue-prompts
 *
 * Speaking prompts for the monologue feature (/speak): short invitations, in
 * the target dialect, to talk about something for a level-scaled stretch.
 * Personalised with the learner's interests where a profile exists, and
 * pitched to their placement band — a beginner gets concrete, familiar topics
 * (your day, your food, your family), an advanced learner gets narrative and
 * opinion topics that force longer turns.
 *
 * Prompts are an invitation, not a script: the learner speaks freely and
 * score-monologue measures the speech, so a prompt only has to open a topic
 * the learner can actually say something about. That is also why this
 * function degrades to a small handwritten prompt bank rather than erroring —
 * a learner ready to record should never be blocked by a generation hiccup.
 *
 * Body: { dialect?: string, count?: number, level?: string }
 * Response: { prompts: MonologuePrompt[], source: "model" | "fallback" }
 */
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { getDialectLabel, getDialectTransliterationRules, type Dialect } from "../_shared/dialectHelpers.ts";
import { learnerPromptBlock } from "../_shared/learnerProfile.ts";
import { emitMetric } from "../_shared/featureMetrics.ts";

const KNOWN_DIALECTS = new Set(["Gulf", "Egyptian", "Yemeni"]);
const MAX_PROMPTS = 3;

interface MonologuePrompt {
  topic_english: string;
  prompt_arabic: string;
  prompt_transliteration: string;
  prompt_english: string;
}

/**
 * The prompt bank the feature falls back to when generation fails. Everyday
 * topics a learner at any level can say *something* about, phrased the way a
 * friend would actually ask.
 */
const FALLBACK_PROMPTS: Record<Dialect, MonologuePrompt[]> = {
  Gulf: [
    {
      topic_english: "Your day",
      prompt_arabic: "وش سويت اليوم من الصبح؟ احكي لي عن يومك",
      prompt_transliteration: "wish sawwait al-yoom min aS-Subh? ihki li 'an yoomik",
      prompt_english: "What have you done today since morning? Tell me about your day.",
    },
    {
      topic_english: "Food you love",
      prompt_arabic: "وش أكثر أكلة تحبها؟ وليش؟",
      prompt_transliteration: "wish akthar akla thibbha? w laish?",
      prompt_english: "What food do you love most, and why?",
    },
    {
      topic_english: "Your week ahead",
      prompt_arabic: "وش خططك هالأسبوع؟ احكي لي",
      prompt_transliteration: "wish khuTaTik hal-usboo'? ihki li",
      prompt_english: "What are your plans this week? Tell me.",
    },
  ],
  Egyptian: [
    {
      topic_english: "Your day",
      prompt_arabic: "عملت إيه النهارده من الصبح؟ احكيلي عن يومك",
      prompt_transliteration: "'amalt eih in-naharda min iS-Subh? ihkeeli 'an yomak",
      prompt_english: "What have you done today since morning? Tell me about your day.",
    },
    {
      topic_english: "Food you love",
      prompt_arabic: "إيه أكتر أكلة بتحبها؟ وليه؟",
      prompt_transliteration: "eih aktar akla bithibbaha? w leih?",
      prompt_english: "What food do you love most, and why?",
    },
    {
      topic_english: "Your week ahead",
      prompt_arabic: "إيه خططك الأسبوع ده؟ احكيلي",
      prompt_transliteration: "eih khuTaTak il-usboo' da? ihkeeli",
      prompt_english: "What are your plans this week? Tell me.",
    },
  ],
  Yemeni: [
    {
      topic_english: "Your day",
      prompt_arabic: "ايش سويت اليوم من الصباح؟ احك لي عن يومك",
      prompt_transliteration: "aish sawwait al-yoom min aS-SabaH? ihk li 'an yoomak",
      prompt_english: "What have you done today since morning? Tell me about your day.",
    },
    {
      topic_english: "Food you love",
      prompt_arabic: "ايش أكثر أكلة تحبها؟ وليش؟",
      prompt_transliteration: "aish akthar akla tHibbha? w laish?",
      prompt_english: "What food do you love most, and why?",
    },
    {
      topic_english: "Your week ahead",
      prompt_arabic: "ايش خططك ذا الأسبوع؟ احك لي",
      prompt_transliteration: "aish khuTaTak dha al-usboo'? ihk li",
      prompt_english: "What are your plans this week? Tell me.",
    },
  ],
};

/** Band-specific topic guidance for the generator. */
function bandGuidance(level: string | undefined): string {
  const upper = level?.toUpperCase() ?? "";
  if (upper.startsWith("C")) {
    return "The learner is advanced: ask for narratives, opinions and comparisons that force a long turn (a story from their life, a view they hold, how something has changed).";
  }
  if (upper.startsWith("B")) {
    return "The learner is intermediate: everyday topics with a 'why' or 'how' attached, so a couple of minutes of speech is natural.";
  }
  return "The learner is a beginner: concrete, familiar topics they already have words for (their day, food, family, home town). One simple question each.";
}

async function generatePrompts(
  userId: string,
  dialect: Dialect,
  count: number,
  level: string | undefined,
): Promise<MonologuePrompt[]> {
  const profileBlock = await learnerPromptBlock({
    userId,
    dialect,
    includeWeak: false,
    includeInterests: true,
  });

  const brain = await askBrain<{ prompts: MonologuePrompt[] }>({
    purpose: "monologue_prompts",
    dialect,
    strategy: "solo",
    temperature: 0.9,
    maxTokens: 1024,
    systemPromptExtra: `You write ${count} short speaking prompts in ${getDialectLabel(dialect)} for a learner to record themselves talking about — the way a friendly conversation partner would open a topic.

Rules:
- Each prompt is 1-2 spoken-style sentences in the dialect, inviting the learner to TALK (not to answer with one word). End with an opening like "tell me about it".
- ${bandGuidance(level)}
- If the learner profile below lists interests, draw topics from them. Every prompt takes a different topic.
- Dialect only, no Modern Standard Arabic.

${profileBlock}

${getDialectTransliterationRules(dialect)}

Return ONLY the structured fields via the provided tool.`,
    userPrompt: `Give me ${count} speaking prompts.`,
    arabicTextPath: (p) =>
      ((p as { prompts?: MonologuePrompt[] } | null)?.prompts ?? [])
        .map((x) => x?.prompt_arabic ?? "")
        .join("\n"),
    tool: {
      name: "emit_monologue_prompts",
      description: "Speaking prompts for a self-recorded monologue.",
      parameters: {
        type: "object",
        properties: {
          prompts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                topic_english: { type: "string", description: "Two-or-three-word English topic label." },
                prompt_arabic: { type: "string", description: "The spoken prompt, in the target dialect, Arabic script." },
                prompt_transliteration: { type: "string", description: "Latin transliteration of prompt_arabic." },
                prompt_english: { type: "string", description: "Natural English translation." },
              },
              required: ["topic_english", "prompt_arabic", "prompt_transliteration", "prompt_english"],
            },
          },
        },
        required: ["prompts"],
      },
    },
  });

  const prompts = (brain.output?.prompts ?? []).filter(
    (p): p is MonologuePrompt => typeof p?.prompt_arabic === "string" && p.prompt_arabic.trim().length > 0,
  );
  return prompts.slice(0, count);
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Cheap solo text generation, same ladder shape as writing-coach's prompt.
  const cap = await enforceDailyCap(req, "monologue-prompts", 15, cors, {
    standard: 60,
    allin: 150,
  });
  if (cap.limited) return cap.response;

  try {
    const body = await req.json().catch(() => ({}));
    const rawDialect: string = (body?.dialect as string) || "Gulf";
    const dialect = (KNOWN_DIALECTS.has(rawDialect) ? rawDialect : "Gulf") as Dialect;
    const count = Math.min(MAX_PROMPTS, Math.max(1, Number(body?.count) || 2));
    const level = typeof body?.level === "string" ? body.level : undefined;

    let prompts: MonologuePrompt[] = [];
    let source: "model" | "fallback" = "model";
    try {
      prompts = await generatePrompts(cap.userId, dialect, count, level);
    } catch (err) {
      console.warn("monologue-prompts: generation failed, serving the bank:", err instanceof Error ? err.message : err);
    }
    if (prompts.length === 0) {
      // The learner is standing at the mic; a generation hiccup must not
      // send them away with an error.
      prompts = FALLBACK_PROMPTS[dialect].slice(0, count);
      source = "fallback";
    }

    // A rising fallback share is the bank quietly becoming the product.
    emitMetric({
      feature: "monologue",
      event: "prompts_served",
      dialect,
      status: source === "model" ? "ok" : "warn",
      count: prompts.length,
      userId: cap.userId,
      meta: { source },
    });

    return new Response(JSON.stringify({ prompts, source }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("monologue-prompts error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
