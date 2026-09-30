import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectLabel, getDialectExamples, type Dialect } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { buildLearnerProfile } from "../_shared/learnerProfile.ts";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { hasAnyProvider } from "../_shared/aiGateway.ts";

interface Challenge {
  type: string;
  title: string;
  titleArabic: string;
  questions: Array<Record<string, unknown>>;
}

// One schema for every weekday's shape: the page switches on `type` and reads
// whichever question fields that type uses, so the item schema lists them all
// as optional rather than forcing seven tools for seven days.
const CHALLENGE_TOOL = {
  name: "emit_challenge",
  description: "Return today's daily challenge.",
  parameters: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["translate", "fill_blank", "unscramble", "match"] },
      title: { type: "string", description: "English title" },
      titleArabic: { type: "string", description: "Arabic title" },
      questions: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "translate: the English (or Arabic) prompt" },
            answer: { type: "string", description: "The correct answer" },
            options: {
              type: "array",
              items: { type: "string" },
              description: "translate / fill_blank: the correct answer plus two wrong ones, shuffled",
            },
            sentence: { type: "string", description: "fill_blank: the sentence with ___ for the blank" },
            sentenceEnglish: { type: "string", description: "fill_blank: English translation" },
            scrambled: { type: "string", description: "unscramble: the letters, shuffled and space-separated" },
            hint: { type: "string", description: "unscramble: English meaning" },
            arabic: { type: "string", description: "match: the Arabic word" },
            english: { type: "string", description: "match: the English word" },
          },
        },
      },
    },
    required: ["type", "title", "titleArabic", "questions"],
  },
};

/** The page needs a type, two titles and at least one question to draw anything. */
function validateChallenge(value: unknown): Challenge | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== "string" || typeof v.title !== "string" || typeof v.titleArabic !== "string") return null;
  if (!Array.isArray(v.questions)) return null;
  const questions = v.questions.filter(
    (q): q is Record<string, unknown> => !!q && typeof q === "object",
  );
  if (questions.length === 0) return null;
  return { type: v.type, title: v.title, titleArabic: v.titleArabic, questions };
}


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Free-tier daily cap (anonymous → 401, paid/admin unlimited).
  const cap = await enforceDailyCap(req, "daily-challenge", 20, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    // `userVocab` in the body is deliberately ignored — see vocabContext below.
    const { streakDays = 0, dialect: rawDialect = "Gulf", difficulty = "beginner" } = await req.json();
    const dialect: Dialect = rawDialect === "Egyptian" || rawDialect === "Yemeni" ? rawDialect : "Gulf";

    if (!hasAnyProvider()) throw new Error("No AI provider configured");

    const dialectLabel = getDialectLabel(dialect);
    const defaultExamples = getDialectExamples(dialect);

    const dayOfWeek = new Date().getDay();
    const challengeTypes = ["translate", "fill_blank", "unscramble", "match", "dictation", "culture", "speed"];
    const todayType = challengeTypes[dayOfWeek];

    // Source the challenge words from the learner's own deck rather than the
    // client-supplied `userVocab`, which was the whole curriculum shuffled
    // (useAllWords) — so the "daily challenge" routinely quizzed words the
    // learner had never studied. Weak and in-progress words come first: those
    // are the ones worth spending a daily challenge on.
    const learnerWords: string[] = [];
    try {
      const profile = await buildLearnerProfile({
        userId: cap.userId,
        dialect,
        budget: { known: 10, learning: 10, weak: 8 },
      });
      // Weak words also appear in known/learning by design, so dedupe on the
      // Arabic form — otherwise duplicates eat the 15 prompt slots.
      const seen = new Set<string>();
      for (const w of [...profile.weak, ...profile.learning, ...profile.known]) {
        if (seen.has(w.arabic)) continue;
        seen.add(w.arabic);
        learnerWords.push(`${w.arabic} (${w.english})`);
      }
    } catch (e) {
      console.warn("daily-challenge: learner profile unavailable, using defaults:", e);
    }

    // No client fallback: `userVocab` was filled by the page from the
    // shuffled curriculum, so exactly the learner with no real history — the
    // one whose challenge should be gentlest — got a challenge built around
    // 15 random words labelled as theirs. The curated defaults are the honest
    // fallback.
    const vocabContext = learnerWords.length > 0
      ? learnerWords.slice(0, 15).join(", ")
      : defaultExamples;

    const streakMultiplier = streakDays >= 7 ? 2.0 : streakDays >= 3 ? 1.5 : 1.0;

    const levelGuidance = difficulty === "advanced"
      ? "Use complex sentences, idioms, and nuanced vocabulary appropriate for advanced learners."
      : difficulty === "intermediate"
      ? "Use moderately complex sentences and vocabulary. Include some challenging words but keep it accessible."
      : "Use simple, common vocabulary and short sentences suitable for beginners.";

    // The dialect identity, Rulebook and worked examples come from askBrain;
    // this is only what is specific to the challenge.
    const systemPrompt = `You are a ${dialectLabel} language challenge generator for a daily challenge feature.

Student level: ${difficulty}. ${levelGuidance}

Return the challenge ONLY by calling the emit_challenge function, in the JSON shape the request describes.`;

    const cultureContext = dialect === "Egyptian"
      ? "Egyptian culture questions about traditions, food, customs from Egypt (Cairo, Alexandria, Upper Egypt)."
      : dialect === "Yemeni"
      ? "Yemeni culture questions about traditions, food, customs from Yemen (Sana'a, Aden, Hadramaut, Ta'izz). Include قات culture, جنبية, سلتة, بنت الصحن, مفرج traditions."
      : "Gulf Arabic culture questions about traditions, food, customs from the UAE, Saudi, Kuwait, Qatar, Bahrain, and Oman.";

    const prompts: Record<string, string> = {
      translate: `Generate 5 translation challenges using these words: ${vocabContext}
Return JSON: { "type": "translate", "title": "Daily Translation", "titleArabic": "ترجمة اليوم", "questions": [{"prompt": "English phrase", "answer": "${dialectLabel} answer", "options": ["option 1", "option 2", "option 3"]}] }
Options should include the correct answer plus 2 wrong ones. Shuffle the positions.`,

      fill_blank: `Generate 5 fill-in-the-blank sentences using these words: ${vocabContext}
Return JSON: { "type": "fill_blank", "title": "Fill the Gap", "titleArabic": "أكمل الفراغ", "questions": [{"sentence": "${dialectLabel} sentence with ___ blank", "sentenceEnglish": "English translation", "answer": "missing word", "options": ["option1", "option2", "option3"]}] }`,

      unscramble: `Generate 5 word unscramble challenges using these words: ${vocabContext}
Return JSON: { "type": "unscramble", "title": "Word Scramble", "titleArabic": "ترتيب الحروف", "questions": [{"scrambled": "shuffled Arabic letters with spaces", "answer": "correct Arabic word", "hint": "English meaning"}] }`,

      match: `Generate 5 matching pairs using these words: ${vocabContext}
Return JSON: { "type": "match", "title": "Match Pairs", "titleArabic": "وصّل الكلمات", "questions": [{"arabic": "${dialectLabel} word", "english": "English word"}] }`,

      dictation: `Generate 5 short ${dialectLabel} phrases for dictation using these words: ${vocabContext}
Return JSON: { "type": "translate", "title": "Daily Dictation", "titleArabic": "إملاء اليوم", "questions": [{"prompt": "English phrase to translate", "answer": "Correct ${dialectLabel}", "options": ["option 1", "option 2", "option 3"]}] }`,

      culture: `Generate 5 ${cultureContext}
Return JSON: { "type": "translate", "title": "Culture Quiz", "titleArabic": "اختبار ثقافي", "questions": [{"prompt": "Cultural question in English", "answer": "Correct answer", "options": ["option 1", "option 2", "option 3"]}] }`,

      speed: `Generate 5 quick-fire ${dialectLabel} vocabulary questions using these words: ${vocabContext}
Return JSON: { "type": "translate", "title": "Speed Round", "titleArabic": "جولة سريعة", "questions": [{"prompt": "What does this mean: ${dialectLabel} word", "answer": "Correct English", "options": ["English option 1", "English option 2", "English option 3"]}] }`,
    };

    let parsed: unknown = null;
    try {
      const brain = await askBrain<unknown>({
        purpose: "daily-challenge",
        dialect,
        strategy: "solo",
        systemPromptExtra: systemPrompt,
        userPrompt: prompts[todayType] || prompts.translate,
        temperature: 0.8,
        maxTokens: 2048,
        tool: CHALLENGE_TOOL,
      });
      parsed = brain.output;
    } catch (err) {
      // askBrain has already walked the fallback chain (same model re-rolled,
      // then the stable rungs, the last on another vendor), so a status here
      // means every rung refused. Same statuses and strings as before the move.
      const status = err instanceof BrainHttpError ? err.status : 0;
      console.error("AI provider error:", status, err instanceof Error ? err.message : err);
      if (status === 402) {
        return new Response(
          JSON.stringify({ error: "Not enough AI credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`AI gateway error: ${status || (err instanceof Error ? err.message : "unknown")}`);
    }

    let challenge = validateChallenge(parsed);
    if (!challenge) {
      console.error("Failed to parse challenge:", JSON.stringify(parsed)?.slice(0, 300));
      const fallbackGreeting = dialect === "Egyptian" ? "أهلاً" : dialect === "Yemeni" ? "مرحبا" : "هلا";
      const fallbackThanks = dialect === "Egyptian" ? "شكراً" : dialect === "Yemeni" ? "مشكور" : "مشكور";
      challenge = {
        type: "translate",
        title: "Daily Challenge",
        titleArabic: "تحدي اليوم",
        questions: [
          { prompt: "Hello", answer: fallbackGreeting, options: [fallbackGreeting, "شكراً", "مع السلامة"] },
          { prompt: "Thank you", answer: fallbackThanks, options: ["هلا", fallbackThanks, "إي"] },
        ],
      };
    }

    return new Response(
      JSON.stringify({ challenge, streakMultiplier, baseXP: 15 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("daily-challenge error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
