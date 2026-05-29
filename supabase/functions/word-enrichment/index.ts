import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface EnrichmentOut {
  definition?: string | null;
  root?: string | null;
  uses?: Array<{ arabic: string; english: string }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { word, dialect, sentenceArabic, sentenceEnglish, isPhrase: isPhraseFlag } = await req.json();
    if (!word || typeof word !== 'string') {
      return new Response(JSON.stringify({ error: 'word is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const trimmed = word.trim().slice(0, 200);
    const isPhrase = Boolean(isPhraseFlag) || /\s/.test(trimmed);

    const hasContext = typeof sentenceArabic === 'string' && sentenceArabic.trim().length > 0;
    const contextLine = hasContext
      ? `\n\nCONTEXT — the ${isPhrase ? 'phrase' : 'word'} appears in this sentence:\nArabic: "${String(sentenceArabic).trim()}"${typeof sentenceEnglish === 'string' && sentenceEnglish.trim() ? `\nEnglish: "${String(sentenceEnglish).trim()}"` : ''}\n\nFor "definition": choose the sense that fits THIS sentence — the meaning consistent with the English translation above, not the most common dictionary meaning.`
      : '';

    const systemExtra = isPhrase
      ? `Task: given a multi-word Arabic PHRASE or expression, return its IDIOMATIC English meaning as a whole — NOT word-by-word. If it's a common collocation or idiom, give the figurative meaning. Also return the root of the head/most lexically meaningful word, and up to 3 related expressions in the SAME dialect.`
      : `Task: given an Arabic word, return its English definition, its root, and up to 3 related words/expressions in the SAME dialect.`;

    const userPrompt = `${isPhrase ? 'Phrase' : 'Word'}: ${trimmed}${contextLine}`;

    const result = await askBrain<EnrichmentOut>({
      purpose: 'vocab_definition',
      dialect: dialect ?? 'Gulf',
      userPrompt,
      systemPromptExtra: systemExtra,
      strategy: 'ensemble',
      maxTokens: 512,
      temperature: 0.2,
      tool: {
        name: 'return_enrichment',
        description: 'Return the word/phrase definition, root, and related uses.',
        parameters: {
          type: 'object',
          properties: {
            definition: { type: 'string', description: 'English meaning' },
            root: { type: 'string', description: 'Trilateral root, e.g. "ك-ت-ب", or empty string if not applicable' },
            uses: {
              type: 'array',
              description: 'Up to 3 related expressions in the same dialect',
              items: {
                type: 'object',
                properties: {
                  arabic: { type: 'string' },
                  english: { type: 'string' },
                },
                required: ['arabic', 'english'],
                additionalProperties: false,
              },
            },
          },
          required: ['definition', 'root', 'uses'],
          additionalProperties: false,
        },
      },
      arabicTextPath: (p) => {
        const o = p as EnrichmentOut;
        return (o.uses ?? []).map((u) => u.arabic).join(' ');
      },
    });

    const out = result.output;
    return new Response(JSON.stringify({
      definition: out.definition || null,
      root: out.root || null,
      uses: Array.isArray(out.uses) ? out.uses.slice(0, 5) : [],
      _meta: { strategy: result.strategy, models: result.models, msaRepairs: result.msaRepairs },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    if (e instanceof BrainHttpError && (e.status === 402 || e.status === 429)) {
      return new Response(JSON.stringify({ error: e.status === 402 ? 'Credits exhausted' : 'Rate limited' }), {
        status: e.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.error('word-enrichment error:', e);
    return new Response(JSON.stringify({ root: null, uses: [] }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
