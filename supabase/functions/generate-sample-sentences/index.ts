import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface SentencesOut {
  sentences: Array<{ arabic: string; english: string }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { word, dialect, definition } = await req.json();
    if (!word || typeof word !== 'string') {
      return new Response(JSON.stringify({ error: 'word is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const defLine = definition ? `\nDefinition/sense to use: "${String(definition).trim()}"` : '';
    const userPrompt = `Word: ${word.trim().slice(0, 100)}${defLine}\n\nGenerate 3 short, natural sentences in this dialect using the word in the given sense. Vary the contexts (home, work, with friends, etc.).`;

    const result = await askBrain<SentencesOut>({
      purpose: 'sample_sentences',
      dialect: dialect ?? 'Gulf',
      userPrompt,
      systemPromptExtra: `Task: generate natural, everyday EXAMPLE SENTENCES using the given word. The sentences must be conversational, NOT MSA, and reflect how a native speaker of this dialect would actually say them.`,
      strategy: 'ensemble',
      maxTokens: 600,
      temperature: 0.7,
      tool: {
        name: 'return_sentences',
        description: 'Return 3 example sentences in the requested dialect.',
        parameters: {
          type: 'object',
          properties: {
            sentences: {
              type: 'array',
              minItems: 3,
              maxItems: 3,
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
          required: ['sentences'],
          additionalProperties: false,
        },
      },
      arabicTextPath: (p) => (p as SentencesOut).sentences.map((s) => s.arabic).join(' '),
    });

    return new Response(JSON.stringify({
      sentences: Array.isArray(result.output.sentences) ? result.output.sentences.slice(0, 5) : [],
      _meta: { strategy: result.strategy, models: result.models, msaRepairs: result.msaRepairs },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    if (e instanceof BrainHttpError && (e.status === 402 || e.status === 429)) {
      return new Response(JSON.stringify({ error: e.status === 402 ? 'Credits exhausted' : 'Rate limited' }), {
        status: e.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.error('generate-sample-sentences error:', e);
    return new Response(JSON.stringify({ sentences: [] }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
