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

async function callAI(
  systemPrompt: string,
  userContent: string,
  apiKey: string,
  model: string,
  maxTokens = 4096,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
      console.error(`AI error (${model}):`, response.status, errText.slice(0, 500));
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
      console.warn(`AI (${model}) returned empty response`);
      return null;
    }
    return content;
  } catch (e) {
    if (e instanceof Error && (e.message.includes('credits') || e.message.includes('Rate limit'))) {
      throw e;
    }
    console.error(`AI fetch failed (${model}):`, e);
    return null;
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

    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fire Qwen, Gemini and Fanar in parallel for translation
    const userContent = `How do I say this in Gulf Arabic: "${trimmedPhrase}"`;
    const FANAR_API_KEY = Deno.env.get('FANAR_API_KEY')?.trim();
    const fanarAvailable = Boolean(FANAR_API_KEY);

    const llmsUsed: string[] = ['qwen/qwen3-30b-a3b (OpenRouter)', 'google/gemini-2.5-flash-preview (OpenRouter)'];
    if (fanarAvailable) llmsUsed.push('Fanar');
    const llmUsed = llmsUsed.join(' + ');
    console.log(`how-do-i-say: LLMs = ${llmUsed}, phrase = "${trimmedPhrase}"`);

    const [rawResponse, geminiRawResponse, fanarRawResponse] = await Promise.all([
      callAI(SYSTEM_PROMPT, userContent, OPENROUTER_API_KEY, 'qwen/qwen3-30b-a3b', 4096),
      callAI(SYSTEM_PROMPT, userContent, OPENROUTER_API_KEY, 'google/gemini-2.5-flash-preview', 4096),
      fanarAvailable
        ? callFanar(SYSTEM_PROMPT, userContent, FANAR_API_KEY!, 4096)
        : Promise.resolve(null),
    ]);

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

    const parsed = rawResponse ? safeJsonParse<any>(rawResponse) : null;
    const geminiParsed = geminiRawResponse ? safeJsonParse<any>(geminiRawResponse) : null;
    const fanarParsed = fanarRawResponse ? safeJsonParse<any>(fanarRawResponse) : null;

    if (!parsed && !geminiParsed && !fanarParsed) {
      throw new Error('Failed to parse AI response. Please try again.');
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

    const qwenTranslations = normTranslations(parsed);
    const geminiTranslations = normTranslations(geminiParsed);
    const fanarTranslations = normTranslations(fanarParsed);

    // Merge: start with Qwen translations, add unique Gemini and Fanar translations by Arabic text
    const seenArabic = new Set(qwenTranslations.map((t: any) => t.arabic));
    const mergedFromGemini = geminiTranslations.filter((t: any) => !seenArabic.has(t.arabic));
    mergedFromGemini.forEach((t: any) => seenArabic.add(t.arabic));
    const mergedFromFanar = fanarTranslations.filter((t: any) => !seenArabic.has(t.arabic));
    if (mergedFromGemini.length > 0) {
      console.log(`how-do-i-say: added ${mergedFromGemini.length} unique translation(s) from Gemini`);
    }
    if (mergedFromFanar.length > 0) {
      console.log(`how-do-i-say: added ${mergedFromFanar.length} unique translation(s) from Fanar`);
    }

    const translations = [...qwenTranslations, ...mergedFromGemini, ...mergedFromFanar];

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
    const qwenVocab = parsed && Array.isArray(parsed.vocabulary)
      ? parsed.vocabulary.filter((v: any) => v?.arabic).map((v: any) => ({
          arabic: String(v.arabic), english: String(v.english ?? ''), root: v.root ? String(v.root) : undefined,
        }))
      : [];
    const geminiVocab = geminiParsed && Array.isArray(geminiParsed.vocabulary)
      ? geminiParsed.vocabulary.filter((v: any) => v?.arabic).map((v: any) => ({
          arabic: String(v.arabic), english: String(v.english ?? ''), root: v.root ? String(v.root) : undefined,
        }))
      : [];
    const fanarVocab = fanarParsed && Array.isArray(fanarParsed.vocabulary)
      ? fanarParsed.vocabulary.filter((v: any) => v?.arabic).map((v: any) => ({
          arabic: String(v.arabic), english: String(v.english ?? ''), root: v.root ? String(v.root) : undefined,
        }))
      : [];
    const vocabArabicSet = new Set(qwenVocab.map((v: any) => v.arabic));
    const extraGeminiVocab = geminiVocab.filter((v: any) => !vocabArabicSet.has(v.arabic));
    extraGeminiVocab.forEach((v: any) => vocabArabicSet.add(v.arabic));
    const vocabulary = [...qwenVocab, ...extraGeminiVocab, ...fanarVocab.filter((v: any) => !vocabArabicSet.has(v.arabic))];

    // Prefer richer cultural notes
    const qwenNotes = parsed?.culturalNotes ? String(parsed.culturalNotes) : undefined;
    const geminiNotes = geminiParsed?.culturalNotes ? String(geminiParsed.culturalNotes) : undefined;
    const fanarNotes = fanarParsed?.culturalNotes ? String(fanarParsed.culturalNotes) : undefined;
    const allNotes = [qwenNotes, geminiNotes, fanarNotes].filter(Boolean) as string[];
    const culturalNotes = allNotes.reduce((best, n) => (!best || n.length > best.length ? n : best), undefined as string | undefined);

    const result = {
      phrase: trimmedPhrase,
      translations,
      vocabulary,
      culturalNotes,
      genderVariants: parsed?.genderVariants ? String(parsed.genderVariants) : (geminiParsed?.genderVariants ? String(geminiParsed.genderVariants) : (fanarParsed?.genderVariants ? String(fanarParsed.genderVariants) : undefined)),
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
