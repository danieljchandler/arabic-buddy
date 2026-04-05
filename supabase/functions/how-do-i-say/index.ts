import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getDialectVocabRules, getDialectLabel } from "../_shared/dialectHelpers.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function extractJsonObject(text: string): string {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
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

async function callFanar(
  systemPrompt: string,
  userContent: string,
  apiKey: string,
  maxTokens = 4096,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  try {
    const response = await fetch('https://api.fanar.qa/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'Fanar',
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
      console.warn('Fanar error:', response.status, errText.slice(0, 300));
      return null;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.warn('Fanar fetch failed (non-fatal):', e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Call an AI model via a generic OpenAI-compatible endpoint (Lovable gateway or OpenRouter). */
async function callAI(
  endpoint: string,
  model: string,
  systemPrompt: string,
  userContent: string,
  apiKey: string,
  maxTokens = 4096,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
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
      console.warn(`AI ${model} error (${endpoint}):`, response.status, errText.slice(0, 500));
      if (response.status === 402) {
        throw new Error('Not enough AI credits. Please add credits to your workspace at Settings → Workspace → Usage.');
      }
      if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please wait a moment and try again.');
      }
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.warn(`AI ${model} returned empty response`);
      return null;
    }
    return content;
  } catch (e) {
    if (e instanceof Error && (e.message.includes('credits') || e.message.includes('Rate limit'))) throw e;
    console.warn(`AI ${model} fetch failed (non-fatal):`, e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const LOVABLE_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

function buildSystemPrompt(dialect: string): string {
  const dialectLabel = getDialectLabel(dialect);
  const vocabRules = getDialectVocabRules(dialect);

  return `You are an expert ${dialectLabel} language teacher${dialect === 'Egyptian' ? '.' : dialect === 'Yemeni' ? ' specialising in the dialects of Yemen (Sana\'ani, Adeni, Hadrami, Ta\'izzi).' : ' specialising in the dialects of the UAE, Saudi Arabia, Kuwait, Bahrain, Qatar, and Oman.'}

${vocabRules}

The user may provide one of three types of input. Detect which it is:

1. TRANSLATION — A word or phrase they want translated into ${dialectLabel}.
   Examples: "I'm tired", "thank you very much", "let's go"

2. SCENARIO — A situation or context description where they want to know what to say.
   Examples: "I'm at a restaurant and want to ask for the bill", "I need to politely decline an invitation"

3. CONVERSATION — A pasted text conversation (two or more messages back and forth) where they want a suggested ${dialectLabel} reply.
   Examples: Multiple chat messages showing an exchange, a WhatsApp conversation

Based on the detected type:
- TRANSLATION: provide 2-4 natural ${dialectLabel} ways to say the phrase.
- SCENARIO: provide 2-4 natural things to say in that situation, ordered from most to least appropriate.
- CONVERSATION: analyse the conversation, understand the tone and relationship, then provide 2-4 natural ${dialectLabel} responses the user could send.

Output ONLY valid JSON matching this exact schema:
{
  "inputMode": "translation" | "scenario" | "conversation",
  "detectedContext": "string - one sentence describing what you understood the user wants",
  "situationSummary": "string (SCENARIO and CONVERSATION modes only)",
  "translations": [
    {
      "arabic": "string - the phrase written in Arabic script",
      "transliteration": "string - romanised pronunciation guide",
      "english": "string - back-translation / contextual meaning in English",
      "context": "string - when/where this phrasing is most natural",
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
- Always set "inputMode" to exactly one of: "translation", "scenario", "conversation".
- Always set "detectedContext" — make it friendly and confirm what you understood.
- Set "situationSummary" for SCENARIO and CONVERSATION modes; omit for TRANSLATION.
- Provide 2-4 translations/phrases/responses ordered from most natural to least. The best one must have isPreferred: true.
- Use ${dialectLabel} vocabulary and spelling (not Modern Standard Arabic / فصحى).
- Transliteration: use simple Latin letters that are easy for English speakers to read.
- Vocabulary: list 3-8 of the most useful individual words, with roots where helpful.
- Keep culturalNotes practical and beginner-friendly.
- No additional text outside JSON.`;
}

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
    const { phrase, dialect: requestDialect } = body;
    const dialect = requestDialect === 'Egyptian' ? 'Egyptian' : requestDialect === 'Yemeni' ? 'Yemeni' : 'Gulf';

    if (!phrase || typeof phrase !== 'string' || phrase.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Please provide a phrase to translate' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const trimmedPhrase = phrase.trim().slice(0, 2000);

    // Resolve available AI services
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    const FANAR_API_KEY = Deno.env.get('FANAR_API_KEY')?.trim();

    if (!LOVABLE_API_KEY && !OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const SYSTEM_PROMPT = buildSystemPrompt(dialect);
    const userContent = trimmedPhrase;

    // Fire ALL available models in parallel (not fallback — results are merged).
    // 1. Lovable gateway: google/gemini-2.5-flash  (reliable built-in AI service)
    // 2. OpenRouter: qwen/qwen3-235b-a22b            (strong reasoning model)
    // 3. OpenRouter: google/gemma-3-12b-it          (best Google model for Arabic)
    // 4. Fanar                                       (optional Gulf Arabic specialist)
    const llmsUsed: string[] = [];
    const fanarAvailable = Boolean(FANAR_API_KEY);

    interface ModelCall { label: string; call: Promise<string | null>; }
    const calls: ModelCall[] = [];

    if (LOVABLE_API_KEY) {
      llmsUsed.push('google/gemini-2.5-flash (Lovable)');
      calls.push({
        label: 'gemini-lovable',
        call: callAI(LOVABLE_GATEWAY, 'google/gemini-2.5-flash', SYSTEM_PROMPT, userContent, LOVABLE_API_KEY, 4096),
      });
    }

    if (OPENROUTER_API_KEY) {
      llmsUsed.push('qwen/qwen3-235b-a22b (OpenRouter)');
      calls.push({
        label: 'qwen-openrouter',
        call: callAI(OPENROUTER_ENDPOINT, 'qwen/qwen3-235b-a22b', SYSTEM_PROMPT, userContent, OPENROUTER_API_KEY, 4096),
      });

      llmsUsed.push('google/gemma-3-12b-it (OpenRouter)');
      calls.push({
        label: 'gemma-openrouter',
        call: callAI(OPENROUTER_ENDPOINT, 'google/gemma-3-12b-it', SYSTEM_PROMPT, userContent, OPENROUTER_API_KEY, 4096),
      });
    }

    if (fanarAvailable) {
      llmsUsed.push('Fanar');
      calls.push({
        label: 'fanar',
        call: callFanar(SYSTEM_PROMPT, userContent, FANAR_API_KEY!, 4096),
      });
    }


    const llmUsed = llmsUsed.join(' + ');
    console.log(`how-do-i-say: LLMs = ${llmUsed}, phrase = "${trimmedPhrase}"`);

    // Fire all available models in parallel. .catch() on each so a rejection from
    // one model doesn't cause an unhandled promise rejection crash in Deno.
    let firstLlmError: Error | null = null;
    const captureLlmError = (e: unknown): null => {
      if (!firstLlmError) firstLlmError = e instanceof Error ? e : new Error(String(e));
      return null;
    };

    const rawResults = await Promise.all(calls.map(c => c.call.catch(captureLlmError)));

    // Map results back to labels
    const resultMap = new Map<string, string | null>();
    calls.forEach((c, i) => resultMap.set(c.label, rawResults[i]));

    // Log which models succeeded
    const succeeded = calls.filter((c, i) => rawResults[i] !== null).map(c => c.label);
    const failed = calls.filter((c, i) => rawResults[i] === null).map(c => c.label);
    if (failed.length > 0) console.warn(`how-do-i-say: failed models: ${failed.join(', ')}`);
    if (succeeded.length > 0) console.log(`how-do-i-say: succeeded models: ${succeeded.join(', ')}`);

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

    // Parse all raw responses
    const parsedResults: (any | null)[] = rawResults.map(r => r ? safeJsonParse<any>(r) : null);

    if (parsedResults.every(p => p === null)) {
      throw firstLlmError ?? new Error('All AI models failed. Please try again.');
    }

    // Normalise translation entries from a parsed result
    function normTranslations(p: any): any[] {
      if (!p || !Array.isArray(p.translations)) return [];
      return p.translations
        .filter((t: any) => t?.arabic && t?.transliteration)
        .map((t: any) => ({
          arabic: String(t.arabic),
          transliteration: String(t.transliteration),
          english: String(t.english ?? ''),
          context: String(t.context ?? ''),
          naturalness: typeof t.naturalness === 'number' ? Math.min(5, Math.max(1, t.naturalness)) : 3,
          isPreferred: !!t.isPreferred,
        }));
    }

    // Merge translations from all sources, deduplicating by Arabic text
    const seenArabic = new Set<string>();
    const translations: any[] = [];
    for (const p of parsedResults) {
      for (const t of normTranslations(p)) {
        if (!seenArabic.has(t.arabic)) {
          seenArabic.add(t.arabic);
          translations.push(t);
        }
      }
    }

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

    // Merge vocabularies from all sources
    const vocabArabicSet = new Set<string>();
    const vocabulary: any[] = [];
    for (const p of parsedResults) {
      if (p && Array.isArray(p.vocabulary)) {
        for (const v of p.vocabulary) {
          if (v?.arabic && !vocabArabicSet.has(String(v.arabic))) {
            vocabArabicSet.add(String(v.arabic));
            vocabulary.push({
              arabic: String(v.arabic),
              english: String(v.english ?? ''),
              root: v.root ? String(v.root) : undefined,
            });
          }
        }
      }
    }

    // Pick the richest cultural notes from any model
    const allNotes = parsedResults
      .map(p => p?.culturalNotes ? String(p.culturalNotes) : undefined)
      .filter(Boolean) as string[];
    const culturalNotes = allNotes.reduce(
      (best, n) => (!best || n.length > best.length ? n : best),
      undefined as string | undefined,
    );

    // Pick gender variants from first model that provides them
    const genderVariants = parsedResults
      .map(p => p?.genderVariants ? String(p.genderVariants) : undefined)
      .find(Boolean);

    // Pick inputMode and detectedContext from the first successful parse
    const firstParsed = parsedResults.find(p => p !== null);
    const VALID_INPUT_MODES = new Set(['translation', 'scenario', 'conversation']);
    const rawInputMode = firstParsed?.inputMode;
    const inputMode: string = (typeof rawInputMode === 'string' && VALID_INPUT_MODES.has(rawInputMode))
      ? rawInputMode
      : 'translation';
    const detectedContext: string | undefined = firstParsed?.detectedContext
      ? String(firstParsed.detectedContext)
      : undefined;
    const situationSummary: string | undefined = parsedResults
      .map(p => p?.situationSummary ? String(p.situationSummary) : undefined)
      .find(Boolean);

    const result = {
      phrase: trimmedPhrase,
      inputMode,
      detectedContext,
      situationSummary,
      translations,
      vocabulary,
      culturalNotes,
      genderVariants,
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
