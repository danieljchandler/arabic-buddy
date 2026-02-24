import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function extractJsonObject(text: string): string {
  const cleaned = text
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function safeJsonParse<T>(content: string): T | null {
  try {
    return JSON.parse(extractJsonObject(content)) as T;
  } catch {
    console.error('JSON parse error for content:', content.slice(0, 500));
    return null;
  }
}

function formatJaisPrompt(systemPrompt: string, userContent: string): string {
  return `### Instruction: ${systemPrompt}\n\n### Input: ${userContent}\n\n### Response:`;
}

/** Normalize RunPod endpoint URL: strip trailing /run, /runsync, or slash */
function normalizeRunpodUrl(url: string): string {
  return url.replace(/\/(run|runsync)\/?$/, '').replace(/\/+$/, '');
}

async function callJais(
  systemPrompt: string,
  userContent: string,
  maxTokens = 4096,
): Promise<string | null> {
  const RUNPOD_URL = Deno.env.get('RUNPOD_ENDPOINT_URL');
  const RUNPOD_KEY = Deno.env.get('RUNPOD_API_KEY');
  if (!RUNPOD_URL || !RUNPOD_KEY) return null;

  const baseUrl = normalizeRunpodUrl(RUNPOD_URL);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50_000);

    const prompt = formatJaisPrompt(systemPrompt, userContent);

    const runpodEndpoint = `${baseUrl}/runsync`;
    console.log('Calling Jais at:', runpodEndpoint);

    const response = await fetch(runpodEndpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${RUNPOD_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          prompt,
          max_tokens: maxTokens,
          temperature: 0.3,
        },
      }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.warn('Jais error:', response.status, 'url:', runpodEndpoint, 'body:', errBody.slice(0, 300));
      return null;
    }

    const data = await response.json();
    console.log('Jais runsync response status:', data?.status, 'keys:', Object.keys(data));

    // RunPod runsync returns { output: ... } - output format depends on worker
    const output = data?.output;
    if (!output) {
      console.warn('Jais returned no output');
      return null;
    }

    // Handle various output formats
    if (typeof output === 'string') return output;
    if (typeof output?.text === 'string') return output.text;
    if (Array.isArray(output) && typeof output[0] === 'string') return output[0];
    if (typeof output?.choices?.[0]?.message?.content === 'string') return output.choices[0].message.content;
    if (typeof output?.choices?.[0]?.text === 'string') return output.choices[0].text;

    console.warn('Jais unexpected output format:', JSON.stringify(output).slice(0, 500));
    return typeof output === 'object' ? JSON.stringify(output) : String(output);
  } catch (e) {
    console.warn('Jais call failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function callAI(
  systemPrompt: string,
  userContent: string,
  apiKey: string,
  maxTokens = 4096,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('AI error:', response.status, errText.slice(0, 500));
      if (response.status === 402) {
        throw new Error('Not enough AI credits. Please add credits to your workspace at Settings → Workspace → Usage.');
      }
      if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please wait a moment and try again.');
      }
      throw new Error(`AI service error (${response.status})`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('AI returned empty response');
    }
    return content;
  } catch (e) {
    if (e instanceof Error && (e.message.includes('credits') || e.message.includes('Rate limit') || e.message.includes('AI service'))) {
      throw e;
    }
    console.error('AI fetch failed:', e);
    throw new Error('AI analysis failed. Please try again.');
  } finally {
    clearTimeout(timeout);
  }
}

const SYSTEM_PROMPT = `You are an expert Gulf Arabic language teacher specialising in the dialects of the UAE, Saudi Arabia, Kuwait, Bahrain, Qatar, and Oman.

Given an English phrase or question, provide multiple natural ways to say it in Gulf Arabic.

Output ONLY valid JSON matching this exact schema:
{
  "translations": [
    {
      "arabic": "string - the phrase written in Arabic script",
      "transliteration": "string - romanised pronunciation guide (use common Gulf Arabic romanisation conventions)",
      "english": "string - back-translation / contextual meaning in English",
      "context": "string - when/where this phrasing is most natural (e.g. 'casual everyday speech', 'formal situations', 'with elders')",
      "naturalness": number between 1-5 (5 = most native-sounding),
      "isPreferred": boolean (true for the single best/most natural option only)
    }
  ],
  "vocabulary": [
    {
      "arabic": "string - individual word",
      "english": "string - word meaning",
      "root": "string (optional) - Arabic root if relevant"
    }
  ],
  "culturalNotes": "string - any important cultural context, politeness levels, gender variants, or usage tips (2-4 sentences)",
  "genderVariants": "string (optional) - if the phrase changes based on speaker/listener gender, explain here"
}

Rules:
- Provide 2-4 translations ordered from most natural / most used to least common. The most natural one must have isPreferred: true.
- Use Gulf Arabic vocabulary and spelling (not Modern Standard Arabic / فصحى).
- Transliteration: use simple Latin letters that are easy for English speakers to read.
- Vocabulary: list 3-8 of the most useful individual words from the translations, with roots where helpful.
- Keep culturalNotes practical and beginner-friendly.
- If the phrase is not something typically said in Arabic culture, still provide the closest equivalents and explain in culturalNotes.
- No additional text outside JSON.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');

  try {
    // Resolve the caller's identity if an auth header is present; anonymous use is allowed.
    let userId: string | null = null;
    if (authHeader?.startsWith('Bearer ')) {
      const supabaseAuth = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await supabaseAuth.auth.getUser();
      userId = user?.id ?? null;
    }

    const body = await req.json();
    const { phrase } = body;

    if (!phrase || typeof phrase !== 'string' || phrase.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Please provide a phrase to translate' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const trimmedPhrase = phrase.trim().slice(0, 500);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Try Jais first (Arabic-specialized), fall back to Lovable AI
    const userContent = `How do I say this in Gulf Arabic: "${trimmedPhrase}"`;
    const jaisResult = await callJais(SYSTEM_PROMPT, userContent, 4096);
    const llmUsed = jaisResult ? 'Jais (RunPod)' : 'google/gemini-3-flash-preview (Lovable AI)';
    console.log(`how-do-i-say: LLM used = ${llmUsed}, phrase = "${trimmedPhrase}"`);
    const rawResponse = jaisResult || await callAI(SYSTEM_PROMPT, userContent, LOVABLE_API_KEY, 4096);

    // Persist LLM usage log to the database
    try {
      const supabaseService = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      await supabaseService.from('llm_usage_logs').insert({
        function_name: 'how-do-i-say',
        llm_used: llmUsed,
        phrase: trimmedPhrase,
        user_id: userId,
      });
    } catch (logErr) {
      console.warn(`how-do-i-say: failed to write llm_usage_log (function=how-do-i-say, user=${userId}):`, logErr instanceof Error ? logErr.message : String(logErr));
    }

    const parsed = safeJsonParse<any>(rawResponse);
    if (!parsed) {
      throw new Error('Failed to parse AI response. Please try again.');
    }

    // Validate and sanitise the result
    const translations = Array.isArray(parsed.translations)
      ? parsed.translations
          .filter((t: any) => t?.arabic && t?.transliteration)
          .map((t: any) => ({
            arabic: String(t.arabic),
            transliteration: String(t.transliteration),
            english: String(t.english ?? ''),
            context: String(t.context ?? ''),
            naturalness: typeof t.naturalness === 'number' ? Math.min(5, Math.max(1, t.naturalness)) : 3,
            isPreferred: !!t.isPreferred,
          }))
      : [];

    if (translations.length === 0) {
      throw new Error('AI could not produce translations. Please try rephrasing.');
    }

    // Ensure exactly one isPreferred = true (the highest naturalness one if none set)
    const hasPreferred = translations.some((t: any) => t.isPreferred);
    if (!hasPreferred) {
      const best = translations.reduce((a: any, b: any) => b.naturalness > a.naturalness ? b : a, translations[0]);
      best.isPreferred = true;
    }

    // Sort: preferred first, then by naturalness descending
    translations.sort((a: any, b: any) => {
      if (a.isPreferred && !b.isPreferred) return -1;
      if (!a.isPreferred && b.isPreferred) return 1;
      return b.naturalness - a.naturalness;
    });

    const vocabulary = Array.isArray(parsed.vocabulary)
      ? parsed.vocabulary
          .filter((v: any) => v?.arabic)
          .map((v: any) => ({
            arabic: String(v.arabic),
            english: String(v.english ?? ''),
            root: v.root ? String(v.root) : undefined,
          }))
      : [];

    const result = {
      phrase: trimmedPhrase,
      translations,
      vocabulary,
      culturalNotes: parsed.culturalNotes ? String(parsed.culturalNotes) : undefined,
      genderVariants: parsed.genderVariants ? String(parsed.genderVariants) : undefined,
      llmUsed,
    };

    const preferred = translations.find((t: any) => t.isPreferred);
    console.log(`how-do-i-say: result = ${translations.length} translation(s) via ${llmUsed}, preferred = "${preferred?.transliteration ?? 'none'}"`);

    return new Response(
      JSON.stringify({ success: true, result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('how-do-i-say error:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
