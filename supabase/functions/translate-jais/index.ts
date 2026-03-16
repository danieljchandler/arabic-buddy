import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const QWEN_MODEL = 'qwen/qwen3-235b-a22b';
const GEMINI_MODEL = 'google/gemini-2.5-flash';

interface RawTranslation {
  arabic?: unknown;
  transliteration?: unknown;
  english?: unknown;
  context?: unknown;
  naturalness?: unknown;
  isPreferred?: unknown;
}

interface RawVocabularyItem {
  arabic?: unknown;
  english?: unknown;
  root?: unknown;
}

interface TranslationPayload {
  translations?: RawTranslation[];
  vocabulary?: RawVocabularyItem[];
  culturalNotes?: unknown;
  genderVariants?: unknown;
}

interface NormalisedTranslation {
  arabic: string;
  transliteration: string;
  english: string;
  context: string;
  naturalness: number;
  isPreferred: boolean;
}

interface NormalisedVocabularyItem {
  arabic: string;
  english: string;
  root?: string;
}

interface QwenDialectCheckResult {
  dialectScore: number;
  isAuthentic: boolean;
  feedback: string;
  correctedArabic: string | null;
}

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

const TRANSLATION_SYSTEM_PROMPT = `You are an expert Gulf Arabic language teacher specialising in the dialects of the UAE, Saudi Arabia, Kuwait, Bahrain, Qatar, and Oman, with deep expertise in the Omani dialect.

Given an English phrase or question, provide multiple natural ways to say it in authentic Omani Gulf Arabic.

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
- Use authentic Omani/Gulf Arabic vocabulary and spelling (not Modern Standard Arabic / فصحى).
- Transliteration: use simple Latin letters that are easy for English speakers to read.
- Vocabulary: list 3-8 of the most useful individual words from the translations, with roots where helpful.
- Keep culturalNotes practical and beginner-friendly.
- If the phrase is not something typically said in Arabic culture, still provide the closest equivalents and explain in culturalNotes.
- No additional text outside JSON.`;

const QWEN_DIALECT_CHECK_PROMPT = `You are an expert in Omani Arabic dialect. You will be given an English phrase and an Arabic translation claimed to be in authentic Omani Gulf Arabic.

Evaluate whether the Arabic translation uses authentic Omani dialect vocabulary and expressions (not MSA or other dialects).

Return ONLY valid JSON:
{
  "dialectScore": number 1-5 (5 = perfectly authentic Omani dialect),
  "isAuthentic": boolean (true if dialectScore >= 3),
  "feedback": "string - brief note on dialect accuracy",
  "correctedArabic": "string or null - provide a corrected version only if dialectScore < 3"
}`;

async function callOpenRouter(
  model: string,
  systemPrompt: string,
  userContent: string,
  apiKey: string,
  maxTokens = 4096,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  try {
    const response = await fetch(OPENROUTER_ENDPOINT, {
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
      console.warn(`OpenRouter ${model} error:`, response.status, errText.slice(0, 500));
      if (response.status === 402) throw new Error('Not enough AI credits. Please add credits to your workspace at Settings → Workspace → Usage.');
      if (response.status === 429) throw new Error('Rate limit exceeded. Please wait a moment and try again.');
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      console.warn(`OpenRouter ${model} returned empty response`);
      return null;
    }
    return content;
  } catch (e) {
    if (e instanceof Error && (e.message.includes('Not enough AI credits') || e.message.includes('Rate limit'))) throw e;
    console.warn(`OpenRouter ${model} fetch failed (non-fatal):`, e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function runQwenDialectCheck(
  phrase: string,
  arabicTranslation: string,
  apiKey: string,
  timeoutMs = 30_000,
): Promise<QwenDialectCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: QWEN_MODEL,
        messages: [
          { role: 'system', content: QWEN_DIALECT_CHECK_PROMPT },
          { role: 'user', content: `English: "${phrase}"\nArabic translation: "${arabicTranslation}"` },
        ],
        max_tokens: 300,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn('Qwen dialect check error:', response.status, errText.slice(0, 200));
      return { dialectScore: 5, isAuthentic: true, feedback: 'check skipped', correctedArabic: null };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    const parsed = safeJsonParse<QwenDialectCheckResult>(content);

    if (!parsed) {
      return { dialectScore: 5, isAuthentic: true, feedback: 'check parse failed', correctedArabic: null };
    }

    return {
      dialectScore: typeof parsed.dialectScore === 'number' ? Math.min(5, Math.max(1, parsed.dialectScore)) : 5,
      isAuthentic: parsed.isAuthentic !== false,
      feedback: String(parsed.feedback ?? ''),
      correctedArabic: parsed.correctedArabic ? String(parsed.correctedArabic) : null,
    };
  } catch (e) {
    console.warn('Qwen dialect check failed (non-fatal):', e instanceof Error ? e.message : String(e));
    return { dialectScore: 5, isAuthentic: true, feedback: 'check unavailable', correctedArabic: null };
  } finally {
    clearTimeout(timeout);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { phrase } = body;

    if (!phrase || typeof phrase !== 'string' || phrase.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Please provide a phrase to translate' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const trimmedPhrase = phrase.trim().slice(0, 500);

    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');

    if (!OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const FANAR_API_KEY = Deno.env.get('FANAR_API_KEY')?.trim();
    const fanarAvailable = Boolean(FANAR_API_KEY);


    const llmsUsed = [`${QWEN_MODEL} (OpenRouter)`, `${GEMINI_MODEL} (OpenRouter)`];
    if (fanarAvailable) llmsUsed.push('Fanar');
    const llmUsed = llmsUsed.join(' + ');
    console.log(`gulf-translate: LLMs = ${llmUsed}, phrase = "${trimmedPhrase}"`);

    // Step 1: Get translations from Qwen + Gemini + Fanar + Jais in parallel
    const userContent = `How do I say this in Omani Gulf Arabic: "${trimmedPhrase}"`;

    // Track wall-clock time so we can skip the sequential dialect-check step
    // if the parallel LLM calls have already consumed most of the 60 s function
    // budget (leaving insufficient room for the extra round-trip).
    const requestStartMs = Date.now();

    // Use .catch() on each call so that if multiple models reject simultaneously
    // (e.g. both return 429), the second rejection is not an unhandled promise
    // rejection that would crash the Deno process with a RUNTIME_ERROR.
    let firstLlmError: Error | null = null;
    const captureLlmError = (e: unknown): null => {
      if (!firstLlmError) firstLlmError = e instanceof Error ? e : new Error(String(e));
      return null;
    };
    const [rawResponse, geminiRawResponse, fanarRawResponse] = await Promise.all([
      callOpenRouter(QWEN_MODEL, TRANSLATION_SYSTEM_PROMPT, userContent, OPENROUTER_API_KEY, 4096).catch(captureLlmError),
      callOpenRouter(GEMINI_MODEL, TRANSLATION_SYSTEM_PROMPT, userContent, OPENROUTER_API_KEY, 4096).catch(captureLlmError),
      fanarAvailable
        ? callFanar(TRANSLATION_SYSTEM_PROMPT, userContent, FANAR_API_KEY!, 4096).catch(captureLlmError)
        : Promise.resolve(null),
    ]);

    const parsed = rawResponse ? safeJsonParse<TranslationPayload>(rawResponse) : null;
    const geminiParsed = geminiRawResponse ? safeJsonParse<TranslationPayload>(geminiRawResponse) : null;
    const fanarParsed = fanarRawResponse ? safeJsonParse<TranslationPayload>(fanarRawResponse) : null;

    if (!parsed && !geminiParsed && !fanarParsed) {
      throw firstLlmError ?? new Error('Failed to parse translation responses. Please try again.');
    }

    // Normalise translations from a parsed result
    function normTranslations(p: TranslationPayload | null): NormalisedTranslation[] {
      if (!p || !Array.isArray(p.translations)) return [];
      return p.translations
        .filter((t: RawTranslation) => t?.arabic && t?.transliteration)
        .map((t: RawTranslation) => ({
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

    // Merge: start with Qwen, add unique Gemini translations, then unique Fanar
    const seenArabic = new Set(qwenTranslations.map(t => t.arabic));
    const mergedFromGemini = geminiTranslations.filter(t => !seenArabic.has(t.arabic));
    mergedFromGemini.forEach(t => seenArabic.add(t.arabic));
    const mergedFromFanar = fanarTranslations.filter(t => !seenArabic.has(t.arabic));
    if (mergedFromGemini.length > 0) {
      console.log(`gulf-translate: added ${mergedFromGemini.length} unique translation(s) from Gemini`);
    }
    if (mergedFromFanar.length > 0) {
      console.log(`gulf-translate: added ${mergedFromFanar.length} unique translation(s) from Fanar`);
    }

    let translations: NormalisedTranslation[] = [...qwenTranslations, ...mergedFromGemini, ...mergedFromFanar];

    if (translations.length === 0) {
      throw new Error('Could not produce translations. Please try rephrasing.');
    }

    // Step 2: Cross-check preferred translation with Qwen for Omani dialect authenticity.
    // Only run if enough wall-clock budget remains (Supabase Edge Functions have a
    // 60 s hard timeout; the parallel calls above can each take up to 55 s, so skip
    // the extra sequential round-trip when we are already close to the limit).
    const preferredIdx = translations.findIndex((t: NormalisedTranslation) => t.isPreferred);
    const preferredTranslation = preferredIdx >= 0 ? translations[preferredIdx] : translations[0];

    const elapsedMs = Date.now() - requestStartMs;
    // Reserve 3 s for response serialisation; cap the dialect check at 30 s.
    // Using a dynamic abort timeout ensures the function never exceeds the 60 s
    // Supabase hard limit regardless of how long the parallel LLM calls took.
    const FUNCTION_HARD_LIMIT_MS = 60_000;
    const RESPONSE_OVERHEAD_MS = 3_000;
    const MAX_DIALECT_CHECK_MS = 30_000;
    const dialectCheckBudgetMs = Math.max(0, Math.min(MAX_DIALECT_CHECK_MS, FUNCTION_HARD_LIMIT_MS - elapsedMs - RESPONSE_OVERHEAD_MS));
    // dialectScore 5 = perfectly authentic (neutral/passing default when skipped).
    const dialectCheck = dialectCheckBudgetMs > 3_000
      ? await runQwenDialectCheck(trimmedPhrase, preferredTranslation.arabic, OPENROUTER_API_KEY, dialectCheckBudgetMs)
      : { dialectScore: 5, isAuthentic: true, feedback: 'skipped (budget)', correctedArabic: null };
    console.log(`gulf-translate: Qwen dialect check score=${dialectCheck.dialectScore}, authentic=${dialectCheck.isAuthentic}, feedback="${dialectCheck.feedback}"`);

    // If Qwen flags the preferred translation as not authentic and provides a correction, apply it
    if (!dialectCheck.isAuthentic && dialectCheck.correctedArabic) {
      const targetIdx = preferredIdx >= 0 ? preferredIdx : 0;
      translations[targetIdx] = { ...translations[targetIdx], arabic: dialectCheck.correctedArabic };
      console.log(`gulf-translate: Qwen dialect correction applied for "${trimmedPhrase}"`);
    }

    // Ensure exactly one isPreferred = true
    const hasPreferred = translations.some((t: NormalisedTranslation) => t.isPreferred);
    if (!hasPreferred) {
      const best = translations.reduce(
        (a: NormalisedTranslation, b: NormalisedTranslation) => b.naturalness > a.naturalness ? b : a,
        translations[0],
      );
      best.isPreferred = true;
    }

    // Sort: preferred first, then by naturalness descending
    translations.sort((a: NormalisedTranslation, b: NormalisedTranslation) => {
      if (a.isPreferred && !b.isPreferred) return -1;
      if (!a.isPreferred && b.isPreferred) return 1;
      return b.naturalness - a.naturalness;
    });

    // Merge vocabularies from Qwen + Gemini + Fanar + Jais
    const qwenVocab: NormalisedVocabularyItem[] = parsed && Array.isArray(parsed.vocabulary)
      ? parsed.vocabulary
          .filter((v: RawVocabularyItem) => v?.arabic)
          .map((v: RawVocabularyItem) => ({
            arabic: String(v.arabic),
            english: String(v.english ?? ''),
            root: v.root ? String(v.root) : undefined,
          }))
      : [];
    const geminiVocab: NormalisedVocabularyItem[] = geminiParsed && Array.isArray(geminiParsed.vocabulary)
      ? geminiParsed.vocabulary
          .filter((v: RawVocabularyItem) => v?.arabic)
          .map((v: RawVocabularyItem) => ({
            arabic: String(v.arabic),
            english: String(v.english ?? ''),
            root: v.root ? String(v.root) : undefined,
          }))
      : [];
    const fanarVocab: NormalisedVocabularyItem[] = fanarParsed && Array.isArray(fanarParsed.vocabulary)
      ? fanarParsed.vocabulary
          .filter((v: RawVocabularyItem) => v?.arabic)
          .map((v: RawVocabularyItem) => ({
            arabic: String(v.arabic),
            english: String(v.english ?? ''),
            root: v.root ? String(v.root) : undefined,
          }))
      : [];
    const jaisVocab: NormalisedVocabularyItem[] = jaisParsed && Array.isArray(jaisParsed.vocabulary)
      ? jaisParsed.vocabulary
          .filter((v: RawVocabularyItem) => v?.arabic)
          .map((v: RawVocabularyItem) => ({
            arabic: String(v.arabic),
            english: String(v.english ?? ''),
            root: v.root ? String(v.root) : undefined,
          }))
      : [];
    const vocabArabicSet = new Set(qwenVocab.map(v => v.arabic));
    const extraGeminiVocab = geminiVocab.filter(v => !vocabArabicSet.has(v.arabic));
    extraGeminiVocab.forEach(v => vocabArabicSet.add(v.arabic));
    const extraFanarVocab = fanarVocab.filter(v => !vocabArabicSet.has(v.arabic));
    extraFanarVocab.forEach(v => vocabArabicSet.add(v.arabic));
    const vocabulary = [...qwenVocab, ...extraGeminiVocab, ...extraFanarVocab, ...jaisVocab.filter(v => !vocabArabicSet.has(v.arabic))];

    // Prefer richer cultural notes
    const qwenNotes = parsed?.culturalNotes ? String(parsed.culturalNotes) : undefined;
    const geminiNotes = geminiParsed?.culturalNotes ? String(geminiParsed.culturalNotes) : undefined;
    const fanarNotes = fanarParsed?.culturalNotes ? String(fanarParsed.culturalNotes) : undefined;
    const jaisNotes = jaisParsed?.culturalNotes ? String(jaisParsed.culturalNotes) : undefined;
    const allNotes = [qwenNotes, geminiNotes, fanarNotes, jaisNotes].filter(Boolean) as string[];
    const culturalNotes = allNotes.reduce((best, n) => (!best || n.length > best.length ? n : best), undefined as string | undefined);

    const genderVariantsSource = [parsed, geminiParsed, fanarParsed, jaisParsed].find(p => p?.genderVariants);
    const genderVariants = genderVariantsSource?.genderVariants ? String(genderVariantsSource.genderVariants) : undefined;

    const result = {
      phrase: trimmedPhrase,
      translations,
      vocabulary,
      culturalNotes,
      genderVariants,
      llmUsed,
      dialectScore: dialectCheck.dialectScore,
      dialectVerified: dialectCheck.isAuthentic,
    };

    // Persist LLM usage log to the database
    try {
      const supabaseService = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      await supabaseService.from('llm_usage_logs').insert({
        function_name: 'translate-jais',
        llm_used: llmUsed,
        phrase: trimmedPhrase,
        user_id: user.id,
      });
    } catch (logErr) {
      console.warn(`gulf-translate: failed to write llm_usage_log (user=${user.id}):`, logErr instanceof Error ? logErr.message : String(logErr));
    }

    const preferred = translations.find((t: NormalisedTranslation) => t.isPreferred);
    console.log(`gulf-translate: result = ${translations.length} translation(s), preferred = "${preferred?.transliteration ?? 'none'}", dialectScore=${dialectCheck.dialectScore}`);

    return new Response(
      JSON.stringify({ success: true, result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('gulf-translate error:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
