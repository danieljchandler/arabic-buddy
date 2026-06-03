import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/errorResponse.ts";
import { getDialectTransliterationRules, type Dialect } from "../_shared/dialectHelpers.ts";

interface PhraseOut {
  phrase_arabic: string;
  phrase_english: string;
  transliteration: string;
  notes: string;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  try {
    const { dialect = "Gulf", seed } = await req.json().catch(() => ({}));
    const today = seed || new Date().toISOString().slice(0, 10);

    const userPrompt = `Generate today's phrase of the day. Today's seed: ${today}.
The phrase must be:
- A short phrase or sentence (3-8 words), NOT a single word
- Authentic, common, and useful in everyday conversation
- Vary the topic each day (greetings, food, travel, feelings, idioms, expressions, etc.)
Include a brief cultural or usage note.`;

    const result = await askBrain<PhraseOut>({
      purpose: 'phrase_of_the_day',
      dialect,
      userPrompt,
      systemPromptExtra: getDialectTransliterationRules(dialect as Dialect),
      strategy: 'ensemble',
      maxTokens: 600,
      temperature: 0.8,
      tool: {
        name: 'return_phrase',
        description: 'Return the phrase of the day with translation and notes',
        parameters: {
          type: 'object',
          properties: {
            phrase_arabic: { type: 'string', description: 'The phrase in Arabic script (dialect)' },
            phrase_english: { type: 'string', description: 'Natural English translation' },
            transliteration: { type: 'string', description: 'Romanized pronunciation' },
            notes: { type: 'string', description: 'Brief cultural or usage note (1-2 sentences)' },
          },
          required: ['phrase_arabic', 'phrase_english', 'transliteration', 'notes'],
          additionalProperties: false,
        },
      },
      arabicTextPath: (p) => (p as PhraseOut).phrase_arabic,
    });

    return new Response(
      JSON.stringify({ ...result.output, dialect, date: today, _meta: { strategy: result.strategy, models: result.models, msaRepairs: result.msaRepairs } }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("phrase-of-the-day error:", err);
    if (err instanceof BrainHttpError) {
      if (err.status === 429) return createErrorResponse(429, "Rate limit exceeded, try again shortly.", cors);
      if (err.status === 402) return createErrorResponse(402, "AI credits exhausted.", cors);
    }
    return createErrorResponse(
      500,
      err instanceof Error ? err.message : "Unknown error",
      cors,
    );
  }
});
