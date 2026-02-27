import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
 
// Helper to generate unique IDs
function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

 // Types matching src/types/transcript.ts
 interface WordToken {
   id: string;
   surface: string;
   standard?: string;
   gloss?: string;
 }
 
 interface TranscriptLine {
   id: string;
   arabic: string;
   translation: string;
   tokens: WordToken[];
 }
 
 interface VocabItem {
   arabic: string;
   english: string;
   root?: string;
 }
 
 interface GrammarPoint {
   title: string;
   explanation: string;
   examples?: string[];
 }
 
 interface TranscriptResult {
   rawTranscriptArabic: string;
   lines: TranscriptLine[];
   vocabulary: VocabItem[];
   grammarPoints: GrammarPoint[];
   culturalContext?: string;
 }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const strictJsonPrefix = (isRetry: boolean) =>
  isRetry
    ? "CRITICAL: Return ONLY valid JSON. No commentary, no markdown, no explanation. Just the JSON object.\n\n"
    : "";

/**
 * IMPORTANT: We intentionally do NOT ask the model to output per-word tokens.
 * That payload explodes in size and often gets truncated, yielding invalid JSON.
 * We generate tokens server-side from the Arabic sentence text.
 */
const getLinesSystemPrompt = (isRetry: boolean = false, hasDualTranscripts: boolean = false, hasTripleTranscripts: boolean = false) => {
  const strictPrefix = strictJsonPrefix(isRetry);
  const multiInstructions = hasTripleTranscripts
    ? `You are given THREE transcriptions of the same Gulf Arabic audio from different speech-to-text engines.
Compare them carefully and produce the BEST merged transcript:
- Where all engines agree, use the shared text.
- Where they differ, choose whichever version sounds most natural and accurate for Gulf Arabic dialect.
- Fanar is an Arabic-native model and may be more accurate for dialect-specific words and phrases.
- Deepgram provides the most reliable word boundaries.
- Munsit specialises in Arabic and may better capture dialectal vocabulary.
- Do NOT simply concatenate them. Merge intelligently at the sentence/clause level.

`
    : hasDualTranscripts
    ? `You are given TWO transcriptions of the same Gulf Arabic audio from different speech-to-text engines.
Compare them carefully and produce the BEST merged transcript:
- Where they agree, use the shared text.
- Where they differ, choose whichever version sounds more natural and accurate for Gulf Arabic dialect.
- Do NOT simply concatenate them. Merge intelligently at the sentence/clause level.

`
    : '';
  return `${strictPrefix}${multiInstructions}You are processing Gulf Arabic transcript text for language learners.

Output ONLY valid JSON matching this schema:
{
  "lines": [{
    "arabic": string,
    "translation": string
  }]
}

CRITICAL RULES FOR SPLITTING:
1. MAXIMUM 12 words per line. If a sentence is longer, SPLIT IT at natural clause boundaries (و، ف، بس، يعني، لأن، عشان).
2. MINIMUM 3 words per line. Merge very short fragments with adjacent content.
3. Each line should be ONE complete thought or clause - typically 5-10 words.
4. Split aggressively at:
   - Punctuation: . ، ؟ ! ؛
   - Conjunctions that start new clauses: و (and), ف (so), بس (but), يعني (meaning)
   - Natural speech pauses or topic shifts
5. Include ALL content from the transcript. Do NOT skip or summarize.
6. Translation must match each Arabic line exactly.
7. Keep dialect spelling as spoken (do NOT normalize to MSA).

EXAMPLE of good splitting:
Long: "رحت السوق وشريت خضار وفواكه وبعدين رجعت البيت وسويت غدا" (too long - 11 words)
Split into:
- "رحت السوق وشريت خضار وفواكه" (6 words)
- "وبعدين رجعت البيت وسويت غدا" (5 words)

No additional text outside JSON.`;
};

const getMetaSystemPrompt = (isRetry: boolean = false) => {
  const strictPrefix = strictJsonPrefix(isRetry);
  return `${strictPrefix}You are processing Gulf Arabic transcript text for language learners.

Output ONLY valid JSON matching this schema:
{
  "vocabulary": [{"arabic": string, "english": string, "root"?: string}],
  "grammarPoints": [{"title": string, "explanation": string, "examples"?: string[]}],
  "culturalContext"?: string
}

Rules:
- Vocabulary: 5–8 useful words with English meaning and root when applicable.
- GrammarPoints: 2–4 dialect-specific points with brief examples from the transcript.
- Keep it concise.

No additional text outside JSON.`;
};

const getWordGlossesPrompt = (isRetry: boolean = false) => {
  const strictPrefix = strictJsonPrefix(isRetry);
  return `${strictPrefix}You are a Gulf Arabic linguist providing English glosses for language learners.

Output ONLY valid JSON matching this schema:
{
  "glosses": {
    "arabicWord": "english meaning",
    "multi word phrase": "english meaning",
    ...
  }
}

Rules:
- Provide an English gloss for EVERY unique Arabic word in the input.
- IMPORTANT: Also add entries for meaningful multi-word compounds/collocations that appear in the input — both 2-word AND 3-word phrases (e.g. "وقت الدورة" = "rush hour", "في الصباح" = "in the morning", "بيت شعر" = "poetry verse"). Use the full phrase as the key.
- For every word that is part of a multi-word phrase, ALSO include it as an individual entry with its standalone meaning (do not omit it).
- Include common particles: و = and, في = in, من = from, على = on, إلى/لـ = to, ما = not/what, هذا/هاذا = this, إذا/لو = if, etc.
- Include pronouns: أنا = I, إنت/أنت = you, هو = he, هي = she, إحنا/نحن = we, هم = they, etc.
- Include verbs in context: provide the meaning as used (e.g., راح = went/will, يبي = wants, أبي = I want).
- For words with multiple meanings, use the contextual meaning from the transcript.
- Keep glosses short (1-4 words).
- Preserve Gulf dialect spellings as keys (do not normalize to MSA).

No additional text outside JSON.`;
};

type GlossesAI = {
  glosses: Record<string, string>;
};
 
type CallAIArgs = {
  systemPrompt: string;
  userContent: string;
  apiKey: string;
  isRetry?: boolean;
  maxTokens?: number;
};

async function callAI({
  systemPrompt,
  userContent,
  apiKey,
  isRetry = false,
  maxTokens = 4096,
}: CallAIArgs): Promise<{ content: string | null; error?: string; status?: number }> {
    const controller = new AbortController();
    // Allow longer timeout for complex transcripts - edge functions can run up to 60s
    const timeoutMs = 55_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Qwen3-30b-a3b via OpenRouter for Gulf Arabic analysis
          model: 'qwen/qwen3-30b-a3b',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          max_tokens: maxTokens,
          temperature: 0.2,
        }),
      });
    } catch (e) {
      const elapsedMs = Date.now() - startedAt;
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      console.error('AI fetch failed:', { isRetry, elapsedMs, isAbort, error: String(e) });
      return {
        content: null,
        error: isAbort ? `AI request timed out after ${timeoutMs}ms` : String(e),
        status: isAbort ? 504 : 500,
      };
    } finally {
      clearTimeout(timeout);
    }

    const elapsedMs = Date.now() - startedAt;
    console.log('AI gateway response:', { status: response.status, ok: response.ok, isRetry, elapsedMs });
 
   if (!response.ok) {
     const errorText = await response.text();
     console.error('AI gateway error body (first 800 chars):', errorText?.slice?.(0, 800) ?? errorText);
     return { content: null, error: errorText, status: response.status };
   }
 
   // Safely read and parse the response body
   let responseText: string;
   try {
     responseText = await response.text();
   } catch (e) {
     console.error('Failed to read response body:', e);
     return { content: null, error: 'Failed to read AI response body', status: 500 };
   }
   
   if (!responseText || responseText.trim().length === 0) {
     console.error('AI gateway returned empty response body');
     return { content: null, error: 'AI returned empty response', status: 500 };
   }
   
   let data;
   try {
     data = JSON.parse(responseText);
   } catch (e) {
     console.error('Failed to parse AI response JSON:', e);
     console.error('Response text (first 500 chars):', responseText.slice(0, 500));
     return { content: null, error: 'Failed to parse AI response as JSON', status: 500 };
   }
   
   const content = data.choices?.[0]?.message?.content;
    return { content };
 }
 
type CallFanarArgs = {
  systemPrompt: string;
  userContent: string;
  apiKey: string;
  model?: string; // 'Fanar' | 'Fanar-C-2-27B' | 'Fanar-Sadiq'
  maxTokens?: number;
  temperature?: number;
};

async function callFanar({
  systemPrompt,
  userContent,
  apiKey,
  model = 'Fanar',
  maxTokens = 4096,
  temperature = 0.2,
}: CallFanarArgs): Promise<{ content: string | null; error?: string; status?: number }> {
  const controller = new AbortController();
  const timeoutMs = 55_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch('https://api.fanar.qa/v1/chat/completions', {
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
        temperature,
      }),
    });
  } catch (e) {
    const elapsedMs = Date.now() - startedAt;
    const isAbort = e instanceof DOMException && e.name === 'AbortError';
    console.error('Fanar fetch failed:', { model, elapsedMs, isAbort, error: String(e) });
    return {
      content: null,
      error: isAbort ? `Fanar request timed out after ${timeoutMs}ms` : String(e),
      status: isAbort ? 504 : 500,
    };
  } finally {
    clearTimeout(timeout);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log('Fanar response:', { model, status: response.status, ok: response.ok, elapsedMs });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Fanar error body (first 800 chars):', errorText?.slice?.(0, 800) ?? errorText);
    return { content: null, error: errorText, status: response.status };
  }

  let responseText: string;
  try {
    responseText = await response.text();
  } catch (e) {
    console.error('Failed to read Fanar response body:', e);
    return { content: null, error: 'Failed to read Fanar response body', status: 500 };
  }

  if (!responseText || responseText.trim().length === 0) {
    console.error('Fanar returned empty response body');
    return { content: null, error: 'Fanar returned empty response', status: 500 };
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    console.error('Failed to parse Fanar response JSON:', e);
    return { content: null, error: 'Failed to parse Fanar response as JSON', status: 500 };
  }

  const content = data.choices?.[0]?.message?.content;
  return { content };
}

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
  } catch (e) {
    console.error('JSON parse error:', e);
    return null;
  }
}

// Create a simple fallback result when AI parsing fails
function createFallbackResult(transcript: string): TranscriptResult {
  // Split by common Arabic sentence endings and newlines
  const sentences = transcript
    .split(/[.،؟!؛\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const lines: TranscriptLine[] = sentences.map((sentence, index) => ({
    id: `line-${generateId()}-${index}`,
    arabic: sentence,
    translation: '',
    tokens: sentence.split(/\s+/).filter(Boolean).map((word, wordIndex) => ({
      id: `token-${generateId()}-${index}-${wordIndex}`,
      surface: word,
    })),
  }));

  return {
    rawTranscriptArabic: transcript,
    lines,
    vocabulary: [],
    grammarPoints: [],
  };
}

// Common Arabic particles/words that AI often skips - fallback dictionary
const COMMON_GLOSSES: Record<string, string> = {
  // Conjunctions & particles
  'و': 'and',
  'أو': 'or',
  'ولا': 'or/nor',
  'بس': 'but/only',
  'لكن': 'but',
  'يعني': 'meaning/like',
  'عشان': 'because/for',
  'لأن': 'because',
  'إذا': 'if',
  'لو': 'if',
  'لما': 'when',
  'بعدين': 'then/after',
  'وبعدين': 'and then',
  'ف': 'so',
  'فـ': 'so',
  // Prepositions
  'في': 'in',
  'من': 'from',
  'على': 'on',
  'إلى': 'to',
  'لـ': 'to/for',
  'ل': 'to/for',
  'مع': 'with',
  'عن': 'about',
  'بـ': 'with/by',
  'ب': 'with/by',
  // Pronouns
  'أنا': 'I',
  'انا': 'I',
  'إنت': 'you',
  'انت': 'you',
  'أنت': 'you',
  'إنتي': 'you (f)',
  'انتي': 'you (f)',
  'هو': 'he',
  'هي': 'she',
  'إحنا': 'we',
  'احنا': 'we',
  'نحن': 'we',
  'هم': 'they',
  'إنتو': 'you (pl)',
  'انتو': 'you (pl)',
  // Demonstratives
  'هذا': 'this',
  'هاذا': 'this',
  'هذي': 'this (f)',
  'هاذي': 'this (f)',
  'ذا': 'this',
  'ذي': 'this (f)',
  'هذاك': 'that',
  'ذاك': 'that',
  'هذيك': 'that (f)',
  'ذيك': 'that (f)',
  // Question words
  'شو': 'what',
  'وش': 'what',
  'ايش': 'what',
  'إيش': 'what',
  'ليش': 'why',
  'ليه': 'why',
  'وين': 'where',
  'كيف': 'how',
  'شلون': 'how',
  'متى': 'when',
  'مين': 'who',
  'منو': 'who',
  'كم': 'how many',
  // Common words
  'الحين': 'now',
  'اليوم': 'today',
  'أمس': 'yesterday',
  'بكرة': 'tomorrow',
  'بكره': 'tomorrow',
  'كل': 'all/every',
  'كثير': 'much/many',
  'واجد': 'much/many',
  'شوي': 'a little',
  'شوية': 'a little',
  'زين': 'good/ok',
  'طيب': 'ok/good',
  'تمام': 'ok/perfect',
  'أوكي': 'ok',
  'لا': 'no/not',
  'نعم': 'yes',
  'إي': 'yes',
  'اي': 'yes',
  'إيه': 'yes',
  'ايه': 'yes',
  'ما': 'not/what',
  'مو': 'not',
  'مب': 'not',
  'مش': 'not',
  'هناك': 'there',
  'هنا': 'here',
  'فيه': 'there is',
  'فيها': 'in it/there is',
  'اللي': 'which/that',
  'الي': 'which/that',
  'يلا': 'let\'s go',
  'خلاص': 'done/enough',
  'بعد': 'also/after',
  // Common verbs
  'كان': 'was',
  'يكون': 'to be',
  'عنده': 'he has',
  'عندي': 'I have',
  'عندك': 'you have',
  'أبي': 'I want',
  'ابي': 'I want',
  'يبي': 'he wants',
  'تبي': 'you want',
  'راح': 'went/will',
  'بيـ': 'will',
  'قال': 'said',
  'يقول': 'says',
};

// Strip Arabic diacritics for fuzzy matching
function stripDiacritics(text: string): string {
  // Remove Arabic diacritics (tashkeel): fatha, damma, kasra, sukun, shadda, etc.
  return text.replace(/[\u064B-\u065F\u0670]/g, '');
}

function toWordTokens(
  arabic: string,
  vocabulary: VocabItem[],
  wordGlosses: Record<string, string> = {}
): WordToken[] {
  // Build maps - both original and stripped versions for fuzzy matching
  const vocabMap = new Map(vocabulary.map((v) => [v.arabic, v.english] as const));
  const vocabMapStripped = new Map(vocabulary.map((v) => [stripDiacritics(v.arabic), v.english] as const));
  
  // Also create stripped version of wordGlosses
  const wordGlossesStripped: Record<string, string> = {};
  for (const [k, v] of Object.entries(wordGlosses)) {
    wordGlossesStripped[stripDiacritics(k)] = v;
  }

  // Helper: lookup a single word in all dictionaries
  function lookupSingle(surface: string): string | undefined {
    const stripped = stripDiacritics(surface);
    return (
      vocabMap.get(surface) ??
      wordGlosses[surface] ??
      vocabMapStripped.get(stripped) ??
      wordGlossesStripped[stripped] ??
      COMMON_GLOSSES[surface] ??
      COMMON_GLOSSES[stripped]
    );
  }

  // Helper: lookup a bigram (two consecutive words joined by space) in glosses/vocab
  function lookupBigram(w1: string, w2: string): string | undefined {
    const bigram = `${w1} ${w2}`;
    const strippedBigram = `${stripDiacritics(w1)} ${stripDiacritics(w2)}`;
    return (
      vocabMap.get(bigram) ??
      wordGlosses[bigram] ??
      vocabMapStripped.get(strippedBigram) ??
      wordGlossesStripped[strippedBigram]
    );
  }

  // Helper: lookup a trigram (three consecutive words) in glosses/vocab
  function lookupTrigram(w1: string, w2: string, w3: string): string | undefined {
    const trigram = `${w1} ${w2} ${w3}`;
    const strippedTrigram = `${stripDiacritics(w1)} ${stripDiacritics(w2)} ${stripDiacritics(w3)}`;
    return (
      vocabMap.get(trigram) ??
      wordGlosses[trigram] ??
      vocabMapStripped.get(strippedTrigram) ??
      wordGlossesStripped[strippedTrigram]
    );
  }

  const words = arabic.split(/\s+/).filter(Boolean);
  const tokens: WordToken[] = [];
  let i = 0;

  while (i < words.length) {
    const surface = words[i];

    // Try trigram first (current word + next two words)
    if (i + 2 < words.length) {
      const trigramGloss = lookupTrigram(surface, words[i + 1], words[i + 2]);
      if (trigramGloss) {
        // Emit first word with the compound gloss
        tokens.push({
          id: `tok-${generateId()}-${i}`,
          surface,
          gloss: trigramGloss,
        });
        // Emit second and third words with reference markers
        tokens.push({
          id: `tok-${generateId()}-${i + 1}`,
          surface: words[i + 1],
          gloss: `(→ ${surface})`, // indicates it's part of the preceding compound
        });
        tokens.push({
          id: `tok-${generateId()}-${i + 2}`,
          surface: words[i + 2],
          gloss: `(→ ${surface})`, // indicates it's part of the preceding compound
        });
        i += 3;
        continue;
      }
    }

    // Try bigram (current word + next word)
    if (i + 1 < words.length) {
      const bigramGloss = lookupBigram(surface, words[i + 1]);
      if (bigramGloss) {
        // Emit first word with the compound gloss
        tokens.push({
          id: `tok-${generateId()}-${i}`,
          surface,
          gloss: bigramGloss,
        });
        // Emit second word with a reference gloss so it's not blank
        tokens.push({
          id: `tok-${generateId()}-${i + 1}`,
          surface: words[i + 1],
          gloss: `(→ ${surface})`, // indicates it's part of the preceding compound
        });
        i += 2;
        continue;
      }
    }

    // Single word lookup
    const gloss = lookupSingle(surface);
    tokens.push({
      id: `tok-${generateId()}-${i}`,
      surface,
      gloss,
    });
    i++;
  }

  return tokens;
}

type LinesAI = {
  lines: Array<{ arabic: string; translation: string }>;
};

type MetaAI = {
  vocabulary: VocabItem[];
  grammarPoints: GrammarPoint[];
  culturalContext?: string;
};

// Fallback: use Qwen + Gemini via OpenRouter for translation when needed
async function lovableAITranslate(arabicLines: string[], apiKey: string): Promise<string[]> {
  const numberedLines = arabicLines.map((line, i) => `${i + 1}. ${line}`).join('\n');
  const messages = [
    {
      role: "system",
      content: "You are an expert translator specializing in Gulf Arabic (Khaliji) dialect. Translate each numbered Arabic line to natural English. Return ONLY the translations, numbered to match. No commentary.",
    },
    {
      role: "user",
      content: `Translate these Gulf Arabic lines to English:\n\n${numberedLines}`,
    },
  ];

  async function callModel(model: string): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages }),
      });
      clearTimeout(timeout);
      if (!response.ok) {
        console.warn(`${model} translation error:`, response.status);
        return null;
      }
      const data = await response.json();
      return data?.choices?.[0]?.message?.content || null;
    } catch (e) {
      clearTimeout(timeout);
      console.warn(`${model} translation failed:`, e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  try {
    const [qwenText, geminiText] = await Promise.all([
      callModel('qwen/qwen3-30b-a3b'),
      callModel('google/gemini-2.5-flash-preview'),
    ]);

    const generatedText = qwenText ?? geminiText ?? '';
    if (!generatedText) return [];

    const translations: string[] = [];
    const respLines = generatedText.split('\n').filter((l: string) => l.trim());
    for (let i = 0; i < arabicLines.length; i++) {
      const lineNum = i + 1;
      const match = respLines.find((l: string) => l.trim().startsWith(`${lineNum}.`) || l.trim().startsWith(`${lineNum})`));
      if (match) {
        translations.push(match.trim().replace(/^\d+[\.\)]\s*/, ''));
      } else if (i < respLines.length) {
        translations.push(respLines[i]?.trim().replace(/^\d+[\.\)]\s*/, '') || '');
      } else {
        translations.push('');
      }
    }
    console.log(`lovableAITranslate: produced ${translations.filter(t => t.length > 0).length}/${arabicLines.length} translations (qwen=${!!qwenText}, gemini=${!!geminiText})`);
    return translations;
  } catch (e) {
    console.warn('lovableAITranslate failed:', e instanceof Error ? e.message : String(e));
    return [];
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Authenticate user
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  try {
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const body = await req.json();
    const { transcript, munsitTranscript, fanarTranscript } = body;

    // ── Quick phrase-translation shortcut ──────────────────────────────────
    // When called with { phrase } (no transcript), translate a short Arabic
    // word or phrase and return { translation } immediately.
    if (body.phrase && typeof body.phrase === 'string') {
      const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
      if (!OPENROUTER_API_KEY) {
        return new Response(JSON.stringify({ error: 'AI service not configured' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      console.log('Phrase translation:', body.phrase);
      const resp = await callAI({
        systemPrompt: 'You are a Gulf Arabic translator. Translate the given Arabic word or phrase to English. Return ONLY the English translation — 1 to 5 words, no punctuation, no explanation.',
        userContent: body.phrase,
        apiKey: OPENROUTER_API_KEY,
        maxTokens: 30,
      });
      const translation = (resp.content ?? '').trim().replace(/^["'.]+|["'.]+$/g, '');
      return new Response(
        JSON.stringify({ translation: translation || null }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // ──────────────────────────────────────────────────────────────────────

    if (!transcript || typeof transcript !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid transcript' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!OPENROUTER_API_KEY) {
      console.error('OPENROUTER_API_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const hasDual = Boolean(munsitTranscript && typeof munsitTranscript === 'string' && munsitTranscript.trim().length > 0);
    const hasFanar = Boolean(fanarTranscript && typeof fanarTranscript === 'string' && fanarTranscript.trim().length > 0);
    const hasTriple = hasDual && hasFanar;
    console.log('Analyzing transcript (lines + meta)...');
    console.log('Deepgram transcript length:', transcript.length);
    if (hasDual) {
      console.log('Munsit transcript length:', munsitTranscript.length);
    }
    if (hasFanar) {
      console.log('Fanar transcript length:', fanarTranscript.length);
    }

    const FANAR_API_KEY = Deno.env.get('FANAR_API_KEY')?.trim();
    const fanarLlmAvailable = Boolean(FANAR_API_KEY);
    if (fanarLlmAvailable) {
      console.log('Fanar LLM conjunction enabled');
    }

     let partial = false;

     // Build user content for lines prompt
     const linesUserContent = hasTriple
       ? `Transcription A (Deepgram):\n${transcript}\n\nTranscription B (Munsit):\n${munsitTranscript}\n\nTranscription C (Fanar):\n${fanarTranscript}`
       : hasDual
       ? `Transcription A (Deepgram):\n${transcript}\n\nTranscription B (Munsit):\n${munsitTranscript}`
       : hasFanar
       ? `Transcription A (Deepgram):\n${transcript}\n\nTranscription B (Fanar):\n${fanarTranscript}`
       : transcript;

     // -----------------------------
     // 1) Sentence split + translation (Qwen + Fanar in parallel)
     // -----------------------------
     let linesAi: LinesAI | null = null;
     let fanarLinesAi: LinesAI | null = null;

     const hasDualOrTriple = hasDual || hasFanar;

     // Fire Qwen and Fanar in parallel for lines
     const qwenLinesPromise = callAI({
       systemPrompt: getLinesSystemPrompt(false, hasDualOrTriple, hasTriple),
       userContent: linesUserContent,
       apiKey: OPENROUTER_API_KEY,
       isRetry: false,
       maxTokens: 8192,
     });

     const fanarLinesPromise = fanarLlmAvailable
       ? callFanar({
           systemPrompt: getLinesSystemPrompt(false, hasDualOrTriple, hasTriple),
           userContent: linesUserContent,
           apiKey: FANAR_API_KEY!,
           maxTokens: 8192,
         })
       : Promise.resolve({ content: null } as { content: string | null });

     const [linesResp, fanarLinesResp] = await Promise.all([qwenLinesPromise, fanarLinesPromise]);

     if (!linesResp.content && linesResp.status) {
       if (linesResp.status === 429) {
         return new Response(
           JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
           { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
         );
       }
       if (linesResp.status === 402) {
         return new Response(
           JSON.stringify({ error: 'AI credits exhausted. Please add credits to continue.' }),
           { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
         );
       }
     }

     if (linesResp.content) {
       linesAi = safeJsonParse<LinesAI>(linesResp.content);
     }
     if (fanarLinesResp.content) {
       fanarLinesAi = safeJsonParse<LinesAI>(fanarLinesResp.content);
       if (fanarLinesAi?.lines) {
         console.log('Fanar lines pass: parsed', fanarLinesAi.lines.length, 'lines');
       }
     }

     if (!linesAi?.lines || !Array.isArray(linesAi.lines) || linesAi.lines.length === 0) {
       // Try Fanar result as fallback before retrying
       if (fanarLinesAi?.lines && Array.isArray(fanarLinesAi.lines) && fanarLinesAi.lines.length > 0) {
         console.log('Qwen lines failed, using Fanar lines as primary');
         linesAi = fanarLinesAi;
         fanarLinesAi = null; // already used as primary
       } else {
         console.log('Lines parse failed, retrying with stricter prompt...');
         const retry = await callAI({
           systemPrompt: getLinesSystemPrompt(true, hasDualOrTriple, hasTriple),
           userContent: linesUserContent,
           apiKey: OPENROUTER_API_KEY,
           isRetry: true,
           maxTokens: 8192,
         });
         if (retry.content) {
           linesAi = safeJsonParse<LinesAI>(retry.content);
         }
       }
     }

     // Fallback if we still can't parse
     if (!linesAi?.lines || !Array.isArray(linesAi.lines) || linesAi.lines.length === 0) {
       console.error('Failed to parse lines JSON; using fallback splitting');
       partial = true;
       const fallback = createFallbackResult(transcript);

       // Still attempt meta extraction (best effort)
       const meta = await (async () => {
         let metaResp = await callAI({
           systemPrompt: getMetaSystemPrompt(false),
           userContent: transcript,
           apiKey: OPENROUTER_API_KEY,
           isRetry: false,
           maxTokens: 2048,
         });
         let metaAi = metaResp.content ? safeJsonParse<MetaAI>(metaResp.content) : null;
         if (!metaAi) {
           const metaRetry = await callAI({
             systemPrompt: getMetaSystemPrompt(true),
             userContent: transcript,
             apiKey: OPENROUTER_API_KEY,
             isRetry: true,
             maxTokens: 2048,
           });
           metaAi = metaRetry.content ? safeJsonParse<MetaAI>(metaRetry.content) : null;
         }
         if (!metaAi) {
           return { vocabulary: [], grammarPoints: [], culturalContext: undefined } as MetaAI;
         }
         return metaAi;
       })();

       const withMeta: TranscriptResult = {
         ...fallback,
         vocabulary: Array.isArray(meta.vocabulary) ? meta.vocabulary : [],
         grammarPoints: Array.isArray(meta.grammarPoints) ? meta.grammarPoints : [],
         culturalContext: meta.culturalContext,
         // Update tokens with vocab glosses if available
         lines: fallback.lines.map((l) => ({
           ...l,
           tokens: toWordTokens(l.arabic, Array.isArray(meta.vocabulary) ? meta.vocabulary : [], {}),
         })),
       };

       return new Response(
         JSON.stringify({ success: true, result: withMeta, partial }),
         { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
       );
     }

     // -----------------------------
     // 2) Falcon H1 translation + Meta extraction (in parallel)
     // -----------------------------
     const arabicLines = linesAi.lines.map(l => String(l.arabic ?? '').trim());
     console.log('Starting parallel: Falcon translation + meta extraction for', arabicLines.length, 'lines');

     // Meta extraction: Qwen + Fanar-Sadiq in parallel
     const metaPromise = (async () => {
       let metaAi: MetaAI | null = null;
       let metaResp = await callAI({
         systemPrompt: getMetaSystemPrompt(false),
         userContent: transcript,
         apiKey: OPENROUTER_API_KEY,
         isRetry: false,
         maxTokens: 2048,
       });
       if (metaResp.content) {
         metaAi = safeJsonParse<MetaAI>(metaResp.content);
       }
       if (!metaAi) {
         const metaRetry = await callAI({
           systemPrompt: getMetaSystemPrompt(true),
           userContent: transcript,
           apiKey: OPENROUTER_API_KEY,
           isRetry: true,
           maxTokens: 2048,
         });
         if (metaRetry.content) {
           metaAi = safeJsonParse<MetaAI>(metaRetry.content);
         }
       }
       return metaAi;
     })();

     // Fanar-Sadiq meta extraction (cultural context specialist)
     const fanarMetaPromise = fanarLlmAvailable
       ? (async () => {
           const fanarMetaResp = await callFanar({
             systemPrompt: getMetaSystemPrompt(false),
             userContent: transcript,
             apiKey: FANAR_API_KEY!,
             model: 'Fanar-Sadiq',
             maxTokens: 2048,
           });
           if (fanarMetaResp.content) {
             return safeJsonParse<MetaAI>(fanarMetaResp.content);
           }
           return null;
         })()
       : Promise.resolve(null as MetaAI | null);

      const [metaAi, fanarMetaAi] = await Promise.all([metaPromise, fanarMetaPromise]);

      // -----------------------------
      // 2b) Merge translations from Qwen + Fanar conjunction
      // -----------------------------
      let finalLines = linesAi.lines;
      const hasFanarLines = fanarLinesAi?.lines && Array.isArray(fanarLinesAi.lines) && fanarLinesAi.lines.length > 0;

      // Determine if we have secondary translations to merge
      const hasMergeSource = hasFanarLines;

      if (hasMergeSource) {
        console.log('Merging translations: +Fanar');

        const mergeContent = arabicLines.map((arabic, i) => {
          const primaryTrans = String(linesAi!.lines[i]?.translation ?? '');
          // Match Fanar lines by index (best effort since sentence boundaries may differ)
          const fanarTrans = hasFanarLines && i < fanarLinesAi!.lines.length
            ? String(fanarLinesAi!.lines[i]?.translation ?? '')
            : '';
          let entry = `Line ${i + 1}: "${arabic}"\n  Qwen: "${primaryTrans}"`;
          if (fanarTrans) entry += `\n  Fanar: "${fanarTrans}"`;
          return entry;
        }).join('\n\n');

       const mergePrompt = `You are merging translations of Gulf Arabic lines from multiple AI models. For each line, pick whichever translation is most natural and accurate, or combine the best parts. Fanar is an Arabic-native model and may capture dialect nuances better. Output ONLY valid JSON:
{"translations": ["merged translation 1", "merged translation 2", ...]}

No additional text outside JSON.`;

       const mergeResp = await callAI({
         systemPrompt: mergePrompt,
         userContent: mergeContent,
         apiKey: OPENROUTER_API_KEY,
         isRetry: false,
         maxTokens: 4096,
       });

       if (mergeResp.content) {
         const merged = safeJsonParse<{ translations: string[] }>(mergeResp.content);
         if (merged?.translations && Array.isArray(merged.translations)) {
           finalLines = linesAi.lines.map((line, i) => ({
             ...line,
             translation: merged.translations[i] || line.translation,
           }));
           console.log('Merge complete: updated', merged.translations.length, 'translations');
         } else {
           console.warn('Merge parse failed, using primary Qwen translations');
         }
       } else {
         console.warn('Merge call failed, using Qwen translations');
       }
      } else {
        console.log('Using Qwen translations from primary analysis pass');
      }

     if (!metaAi) {
       partial = true;
     }
     const safeMetaAi = metaAi || { vocabulary: [], grammarPoints: [] };
     let vocab = Array.isArray(safeMetaAi.vocabulary) ? safeMetaAi.vocabulary : [];
     let grammarPoints = Array.isArray(safeMetaAi.grammarPoints) ? safeMetaAi.grammarPoints : [];
     let culturalContext = safeMetaAi.culturalContext;

     // Merge Fanar-Sadiq meta results if available
     if (fanarMetaAi) {
       console.log('Merging Fanar-Sadiq meta results...');
       // Union vocabularies (deduplicate by Arabic text)
       if (Array.isArray(fanarMetaAi.vocabulary)) {
         const existingArabic = new Set(vocab.map(v => v.arabic));
         const newVocab = fanarMetaAi.vocabulary.filter(v => v.arabic && !existingArabic.has(v.arabic));
         if (newVocab.length > 0) {
           vocab = [...vocab, ...newVocab];
           console.log(`Added ${newVocab.length} vocab items from Fanar-Sadiq`);
         }
       }
       // Union grammar points (deduplicate by title)
       if (Array.isArray(fanarMetaAi.grammarPoints)) {
         const existingTitles = new Set(grammarPoints.map(g => g.title.toLowerCase()));
         const newGrammar = fanarMetaAi.grammarPoints.filter(g => g.title && !existingTitles.has(g.title.toLowerCase()));
         if (newGrammar.length > 0) {
           grammarPoints = [...grammarPoints, ...newGrammar];
           console.log(`Added ${newGrammar.length} grammar points from Fanar-Sadiq`);
         }
       }
       // Prefer Fanar-Sadiq cultural context if richer (longer)
       if (fanarMetaAi.culturalContext && (!culturalContext || fanarMetaAi.culturalContext.length > culturalContext.length)) {
         culturalContext = fanarMetaAi.culturalContext;
         console.log('Using Fanar-Sadiq cultural context (richer)');
       }
     }

     // -----------------------------
     // 3) Comprehensive word glosses (Qwen + Fanar in parallel)
     // -----------------------------
     let wordGlosses: Record<string, string> = {};

     // Extract all unique words from all lines
     const allWords = new Set<string>();
     for (const line of finalLines) {
       const words = String(line.arabic ?? '').split(/\s+/).filter(Boolean);
       words.forEach(w => allWords.add(w));
     }

     console.log('Fetching glosses for', allWords.size, 'unique words...');

      // Include the full transcript lines for compound/collocation detection
      const glossesContext = `Full transcript for compound detection:\n${finalLines.map(l => l.arabic).join('\n')}\n\nUnique words to gloss:\n${Array.from(allWords).join(' ')}`;

      // Fire Qwen and Fanar glosses in parallel
      const qwenGlossesPromise = callAI({
        systemPrompt: getWordGlossesPrompt(false),
        userContent: glossesContext,
        apiKey: OPENROUTER_API_KEY,
        isRetry: false,
        maxTokens: 4096,
      });

      const fanarGlossesPromise = fanarLlmAvailable
        ? callFanar({
            systemPrompt: getWordGlossesPrompt(false),
            userContent: glossesContext,
            apiKey: FANAR_API_KEY!,
            maxTokens: 4096,
          })
        : Promise.resolve({ content: null } as { content: string | null });

      const [glossesResp, fanarGlossesResp] = await Promise.all([qwenGlossesPromise, fanarGlossesPromise]);

      if (glossesResp.content) {
        const glossesAi = safeJsonParse<GlossesAI>(glossesResp.content);
        if (glossesAi?.glosses && typeof glossesAi.glosses === 'object') {
          wordGlosses = glossesAi.glosses;
          console.log('Qwen: parsed', Object.keys(wordGlosses).length, 'word glosses');
        }
      }

      // Merge Fanar glosses (Fanar overwrites for dialect-specific words)
      if (fanarGlossesResp.content) {
        const fanarGlossesAi = safeJsonParse<GlossesAI>(fanarGlossesResp.content);
        if (fanarGlossesAi?.glosses && typeof fanarGlossesAi.glosses === 'object') {
          const fanarGlossCount = Object.keys(fanarGlossesAi.glosses).length;
          // Overlay Fanar glosses on top (Arabic-native advantage for dialect words)
          wordGlosses = { ...wordGlosses, ...fanarGlossesAi.glosses };
          console.log(`Fanar: merged ${fanarGlossCount} glosses (total: ${Object.keys(wordGlosses).length})`);
        }
      }

      // Retry if we got no glosses from either
      if (Object.keys(wordGlosses).length === 0) {
        console.log('Word glosses parse failed, retrying...');
        const glossesRetry = await callAI({
          systemPrompt: getWordGlossesPrompt(true),
          userContent: glossesContext,
          apiKey: OPENROUTER_API_KEY,
          isRetry: true,
          maxTokens: 4096,
        });
        if (glossesRetry.content) {
          const glossesAi = safeJsonParse<GlossesAI>(glossesRetry.content);
          if (glossesAi?.glosses && typeof glossesAi.glosses === 'object') {
            wordGlosses = glossesAi.glosses;
            console.log('Retry: parsed', Object.keys(wordGlosses).length, 'word glosses');
          }
        }
      }

     // Build the full TranscriptResult
     const transcriptResult: TranscriptResult = {
       rawTranscriptArabic: transcript,
       lines: finalLines.map((l, idx) => ({
         id: `line-${generateId()}-${idx}`,
         arabic: String(l.arabic ?? '').trim(),
         translation: String(l.translation ?? '').trim(),
         tokens: toWordTokens(String(l.arabic ?? '').trim(), vocab, wordGlosses),
       })),
       vocabulary: vocab,
       grammarPoints,
       culturalContext,
     };

     console.log(
       'Analysis complete:',
       transcriptResult.lines.length,
       'lines,',
       transcriptResult.vocabulary.length,
       'vocab items',
       partial ? '(partial)' : ''
     );

     return new Response(
       JSON.stringify({ success: true, result: transcriptResult, partial }),
       { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
     );

  } catch (error) {
    console.error('Error in analyze-gulf-arabic function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
