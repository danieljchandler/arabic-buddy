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
   culturalContext?: string;
   idiomaticNuance?: string;
   dialectNotes?: string;
   exampleSentence?: { arabic: string; english: string };
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
  dialectValidation?: { content: string; timestamp: string } | null;
  dialect?: 'Saudi' | 'Kuwaiti' | 'UAE' | 'Bahraini' | 'Qatari' | 'Omani' | 'Gulf';
  /** Full merged Arabic transcript with tashkeel added by Farasa. Feed to ElevenLabs TTS for accurate pronunciation. */
  diacritizedTranscript?: string | null;
  /** Dialect identification from CAMeL-Lab BERT model (city-level, independent of LLM). */
  camelDialect?: { code: string; dialect: string; confidence: number; isGulf: boolean } | null;
 }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const strictJsonPrefix = (isRetry: boolean) =>
  isRetry
    ? "CRITICAL: Return ONLY valid JSON. No commentary, no markdown, no explanation. Just the JSON object.\n\n"
    : "";

const getDialectNote = (dialect?: string, prefix = '\n') =>
  dialect && dialect !== 'Gulf'
    ? `${prefix}The speaker is using ${dialect} Gulf Arabic dialect.`
    : `${prefix}The speaker is using Gulf Arabic (Khaliji) dialect.`;

/**
 * IMPORTANT: We intentionally do NOT ask the model to output per-word tokens.
 * That payload explodes in size and often gets truncated, yielding invalid JSON.
 * We generate tokens server-side from the Arabic sentence text.
 */
// ─── CALL 1 PROMPT ───────────────────────────────────────────────────────────
// Transcript merging only. Produces Arabic lines with NO translations.
// Translations, vocabulary, and grammar are handled in Call 2.
const getMergeOnlySystemPrompt = (isRetry: boolean = false, hasDualTranscripts: boolean = false, hasTripleTranscripts: boolean = false) => {
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
- ALWAYS prefer the spoken/dialectal form over formal/MSA spelling. Write words as they are pronounced.
- Use ALL three transcripts to ensure NO spoken content is missed — include every word that was said.

`
    : hasDualTranscripts
    ? `You are given TWO transcriptions of the same Gulf Arabic audio from different speech-to-text engines.
Compare them carefully and produce the BEST merged transcript:
- Where they agree, use the shared text.
- Where they differ, choose whichever version sounds more natural and accurate for Gulf Arabic dialect.
- Do NOT simply concatenate them. Merge intelligently at the sentence/clause level.
- ALWAYS prefer the spoken/dialectal form over formal/MSA spelling. Write words as they are pronounced.
- Use BOTH transcripts to ensure NO spoken content is missed — include every word that was said.

`
    : '';
  return `${strictPrefix}${multiInstructions}You are merging Gulf Arabic speech-to-text transcriptions for language learners.

Output ONLY valid JSON matching this schema:
{
  "lines": [{"arabic": string}],
  "dialect": "Saudi" | "Kuwaiti" | "UAE" | "Bahraini" | "Qatari" | "Omani" | "Gulf"
}

DIALECT IDENTIFICATION RULES:
Identify the Gulf Arabic dialect based on vocabulary, phonology, and speech patterns. Use ONLY one of these exact string values:
- "Saudi": Najdi/Hijazi — "وش"/"إيش" (what), "الحين" (now), "يبي"/"يبغى" (want), "يسير" (go), Najdi "g" for ق, "عيال" (kids), "شلون" (how are you).
- "Kuwaiti": "شنو" (what), "هواية" (a lot), "چذي"/"چذا" (like this), distinctive "چ" for ك in some words, "يبه" (wow), "ليش" (why).
- "UAE": "شو" with Levantine influence, "عيل" (then/so), "الحين" (now), "يلا" very frequent, Emirati "گ" for ق in some words, "شويه" (a bit).
- "Bahraini": Hybrid "شو"/"شنو", "ب"-prefixed verbs (بيروح/بيجي), features shared with both Kuwaiti and Eastern Saudi.
- "Qatari": "ش"-prefix interrogative patterns, "هاي" (this), Bedouin vocabulary influence, intonation distinct from Kuwaiti.
- "Omani": "إيش"/"ايش" (what), "حق" (for/of), universal "j" for ج, "كيف" used as greeting response, Dhofari/Muscat variation.
- "Gulf": ONLY if genuinely ambiguous — cannot be attributed to a single country with confidence.

KEY SIGNALS:
- What: شنو(KW/BH/QA) | وش/إيش(SA) | شو(UAE/BH) | إيش(OM)
- Want: يبي/يبغى(SA/KW) | يريد(MSA — avoid)
- Now: الحين(SA/UAE) | هلأ | الكيف(OM)
- How/fine: شلون(SA/KW) | كيف(OM/formal) | زين(universal Gulf = good)
- چ/گ consonant shifts → KW or UAE
- ب-prefix on future verbs → BH
- حق possessive → OM

CRITICAL RULES FOR SPLITTING:
1. MAXIMUM 12 words per line. If a sentence is longer, SPLIT IT at natural clause boundaries (و، ف، بس، يعني، لأن، عشان).
2. MINIMUM 3 words per line. Merge very short fragments with adjacent content.
3. Each line should be ONE complete thought or clause - typically 5-10 words.
4. Split aggressively at:
   - Punctuation: . ، ؟ ! ؛
   - Conjunctions that start new clauses: و (and), ف (so), بس (but), يعني (meaning)
   - Natural speech pauses or topic shifts
5. Include ALL content from the transcript. Do NOT skip, summarize, or omit ANY spoken content. Every word that was said must appear in the output.
6. CRITICAL — SPOKEN FORM ONLY: Write Arabic EXACTLY as it is pronounced/spoken, NOT with proper/standard Arabic spelling. Use dialectal/colloquial forms. Examples:
   - Write "هالشي" NOT "هذا الشيء"
   - Write "وش" NOT "ماذا"
   - Write "يبي" NOT "يريد"
   - Write "وين" NOT "أين"
   - Write "شلون" NOT "كيف"
   - Write "اللحين" or "الحين" NOT "الآن"
   - Keep contractions, slang, filler words (يعني، هيه، آه) exactly as spoken.
   - Do NOT correct grammar or normalize spelling to MSA/formal Arabic.

IMPORTANT: Output Arabic text ONLY — no "translation" field in this step.

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

// ─── CALL 2 PROMPT ───────────────────────────────────────────────────────────
// Analysis and enrichment. Receives the clean merged transcript from Call 1.
// Produces per-line translations, vocabulary, and grammar points.
const getAnalysisSystemPrompt = (isRetry: boolean = false, dialect?: string) => {
  const strictPrefix = strictJsonPrefix(isRetry);
  const dialectNote = dialect && dialect !== 'Gulf'
    ? `\nThe audio is ${dialect} Gulf Arabic dialect. Prioritise ${dialect}-specific vocabulary, grammar patterns, and cultural notes in your output.`
    : '\nThe audio is Gulf Arabic (Khaliji) dialect.';
  return `${strictPrefix}You are analyzing a Gulf Arabic transcript for language learners. You are given a clean pre-merged transcript split into numbered Arabic lines.${dialectNote}

Output ONLY valid JSON matching this schema:
{
  "lines": [{"arabic": string, "translation": string}],
  "vocabulary": [{"arabic": string, "english": string, "root"?: string}],
  "grammarPoints": [{"title": string, "explanation": string, "examples"?: string[]}],
  "culturalContext"?: string
}

Rules:
- lines: IMPORTANT — the output "lines" array MUST include ALL numbered lines from the input. Every single line, no exceptions. Do not omit, skip, or stop early. Keep the Arabic text EXACTLY as given. Provide a natural English translation for each line.
- vocabulary: 5–8 useful Gulf Arabic words or phrases with English meaning and root when applicable.
- grammarPoints: 2–4 dialect-specific grammar points with brief examples from the transcript.
- culturalContext: Optional brief cultural note about the content.
- Keep translations and explanations concise.

No additional text outside JSON.`;
};

// ─── VOCAB ENRICHMENT PROMPT ─────────────────────────────────────────────────
// Sent to Claude Sonnet after the full vocab assembly (Qwen + Fanar union).
// Claude enriches each item — it never replaces Qwen's output.
const getVocabEnrichmentSystemPrompt = () =>
  `You are enriching a Gulf Arabic vocabulary list for language learners.
For each vocabulary item provided, add Gulf-specific depth.

Output ONLY valid JSON matching this schema:
{
  "enrichments": [
    {
      "arabic": "<exact arabic word as given>",
      "culturalContext": "<cultural context specific to Gulf/Khaliji usage>",
      "idiomaticNuance": "<how the word is actually used vs its literal meaning>",
      "dialectNotes": "<how this differs from MSA or other Arabic dialects — omit if not meaningfully different>",
      "exampleSentence": { "arabic": "<natural Gulf Arabic sentence>", "english": "<translation>" }
    }
  ]
}

Rules:
- One enrichment object per vocabulary item, matched by the exact arabic field value
- Keep each field concise (1–2 sentences)
- dialectNotes: only include when the word genuinely differs from MSA usage
- Output ONLY valid JSON. No commentary outside JSON.`;

// ─── FANAR DIALECT VALIDATION PROMPT ────────────────────────────────────────
// Sent to Fanar-C-2-27B after merge, in parallel with translation.
// Read-only: result is stored for review, never used to modify transcript.
const getFanarValidationSystemPrompt = () =>
  `أنت خبير في اللهجة الخليجية. راجع هذا النص المنقول وحدد أي مشاكل في:
- كلمات تبدو مُحوَّلة إلى الفصحى بدلاً من اللهجة الخليجية المحكية
- كلمات أو عبارات تبدو مكتوبة بشكل غير صحيح أو مُحرَّفة
- محتوى لا يتوافق ثقافياً مع السياق الخليجي

اذكر رقم السطر والكلمة والمشكلة بإيجاز. إذا لم تجد مشاكل، قل ذلك بجملة واحدة.
يمكنك الإجابة بالعربية أو الإنجليزية.`;

// ─── TRANSLATION PROMPT ──────────────────────────────────────────────────────
// Used by Gemini 2.5 Flash (primary) and Qwen (fallback).
// Receives the numbered merged transcript produced by Call 1.
// Produces ONLY per-line translations — no vocabulary, no grammar.
const getTranslationSystemPrompt = (dialect?: string, visualContext?: string) => {
  const dialectNote = dialect && dialect !== 'Gulf'
    ? `${getDialectNote(dialect)} Reflect regional vocabulary and expressions in your translations where appropriate.`
    : getDialectNote(undefined);
  const visualNote = visualContext
    ? `\n\nVideo context: ${visualContext}\nUse this context to improve translation accuracy and naturalness where relevant.`
    : '';
  return `You are a Gulf Arabic translator specializing in the Gulf/Khaliji dialect.${dialectNote}${visualNote}
You will be given numbered Arabic lines. Translate each line to natural English.

Output ONLY valid JSON matching this schema:
{"translations": ["English for line 1", "English for line 2", ...]}

Rules:
- The output array must have exactly the same number of items as there are numbered lines.
- Translations should be natural and idiomatic, not word-for-word.
- Preserve the tone and meaning of Gulf Arabic dialect.
- Keep each translation concise.

No additional text outside JSON.`;
};

// Returned by the dedicated translation call (Gemini primary / Qwen fallback)
type TranslationAI = { translations: string[] };

// Returned by Call 1 (merge only — no translations)
type MergeOnlyAI = {
  lines: Array<{ arabic: string }>;
  dialect?: 'Saudi' | 'Kuwaiti' | 'UAE' | 'Bahraini' | 'Qatari' | 'Omani' | 'Gulf';
};
 
type CallAIArgs = {
  systemPrompt: string;
  userContent: string;
  apiKey: string;
  isRetry?: boolean;
  maxTokens?: number;
  model?: string; // defaults to 'qwen/qwen3-235b-a22b'
  gateway?: 'openrouter' | 'lovable'; // defaults to 'openrouter'
};

async function callAI({
  systemPrompt,
  userContent,
  apiKey,
  isRetry = false,
  maxTokens = 4096,
  model = 'qwen/qwen3-235b-a22b',
  gateway = 'openrouter',
}: CallAIArgs): Promise<{ content: string | null; error?: string; status?: number }> {
    const isLovable = gateway === 'lovable';
    const gatewayUrl = isLovable
      ? 'https://ai.gateway.lovable.dev/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions';
    const gatewayKey = isLovable ? (Deno.env.get('LOVABLE_API_KEY') ?? '') : apiKey;

    const controller = new AbortController();
    // Allow longer timeout for complex transcripts - edge functions can run up to 60s
    const timeoutMs = 55_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(gatewayUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${gatewayKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
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

async function callRunPodModel(
  endpoint: string,
  model: string,
  systemPrompt: string,
  userContent: string,
  apiKey: string,
  maxTokens = 4096,
): Promise<{ content: string | null }> {
  // RunPod serverless endpoints need cold-start time (up to 60s+), so use a
  // generous 90s timeout to avoid aborting during spin-up.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

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
      console.warn(`RunPod ${model} error:`, response.status);
      return { content: null };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? null;
    console.log(`RunPod ${model} response:`, content?.slice(0, 200));
    return { content };
  } catch (e) {
    console.warn(`RunPod ${model} failed (non-fatal):`, e instanceof Error ? e.message : String(e));
    return { content: null };
  } finally {
    clearTimeout(timeout);
  }
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

// Returned by Call 2 (translations + vocabulary + grammar from merged transcript)
type AnalysisAI = {
  lines: Array<{ arabic: string; translation: string }>;
  vocabulary: VocabItem[];
  grammarPoints: GrammarPoint[];
  culturalContext?: string;
};

type ClaudeEnrichmentAI = {
  enrichments: Array<{
    arabic: string;
    culturalContext?: string;
    idiomaticNuance?: string;
    dialectNotes?: string;
    exampleSentence?: { arabic: string; english: string };
  }>;
};

type MetaAI = {
  vocabulary: VocabItem[];
  grammarPoints: GrammarPoint[];
  culturalContext?: string;
};

// ── CAMeL-Lab dialect identification ─────────────────────────────────────────
// Model: CAMeL-Lab/bert-base-arabic-camelbert-mix-did-madar-twitter
// Runs in parallel with Call 2 to validate the LLM-detected dialect.
// Returns null on any failure so it never blocks the pipeline.
const CAMEL_CITY_TO_DIALECT: Record<string, string> = {
  KUW: 'Kuwaiti', DOH: 'Qatari',   RIY: 'Saudi', JED: 'Saudi',
  ABU: 'UAE',     DUB: 'UAE',      MSC: 'Omani', BAH: 'Bahraini',
};
const CAMEL_GULF_CITIES = new Set(Object.keys(CAMEL_CITY_TO_DIALECT));

async function callCamelDialect(
  text: string,
  hfApiKey: string,
): Promise<{ code: string; dialect: string; confidence: number; isGulf: boolean } | null> {
  // Use only first 512 chars — dialect is detectable from short samples and
  // shorter input keeps latency low (BERT has a 512-token limit anyway).
  const sample = text.trim().slice(0, 512);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const resp = await fetch(
      'https://api-inference.huggingface.co/models/CAMeL-Lab/bert-base-arabic-camelbert-mix-did-madar-twitter',
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Authorization': `Bearer ${hfApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: sample }),
      },
    );
    if (!resp.ok) {
      // 503 = model cold-starting — expected on free HF tier, non-fatal
      console.warn(`CAMeL dialect model: HTTP ${resp.status} (cold start or unavailable)`);
      return null;
    }
    const predictions: { label: string; score: number }[] = await resp.json();
    if (!Array.isArray(predictions) || !predictions[0]) return null;
    const top = predictions[0];
    const code = top.label.toUpperCase();
    const dialect = CAMEL_CITY_TO_DIALECT[code] ?? code;
    const isGulf = CAMEL_GULF_CITIES.has(code);
    return { code, dialect, confidence: Math.round(top.score * 1000) / 1000, isGulf };
  } catch (e) {
    console.warn('CAMeL dialect call failed:', e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Farasa diacritization ─────────────────────────────────────────────────────
// Adds short vowels (tashkeel) to unvoweled Arabic text via the QCRI Farasa
// REST API. The diacritized output is included in the response for downstream
// ElevenLabs TTS calls, which produce more accurate pronunciation with tashkeel.
async function callFarasaDiacritize(text: string): Promise<string | null> {
  // Try multiple Farasa endpoint URL patterns — the API has historically moved
  // between /webapi/diac/ and /webapi/diacritize/ paths.
  const FARASA_URLS = [
    'https://farasa.qcri.org/webapi/diac/',
    'https://farasa.qcri.org/webapi/diacritize/',
    'https://farasa-api.qcri.org/webapi/diac/',
  ];

  for (const url of FARASA_URLS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ text }).toString(),
      });
      if (resp.status === 404) {
        console.warn(`Farasa diac: 404 at ${url}, trying next URL...`);
        continue;
      }
      if (!resp.ok) {
        console.warn(`Farasa diac: HTTP ${resp.status} at ${url}`);
        return null;
      }
      const data = await resp.json();
      console.log(`Farasa diac: success via ${url}`);
      return (data.text ?? data.output ?? null) as string | null;
    } catch (e) {
      console.warn(`Farasa diacritize failed at ${url}:`, e instanceof Error ? e.message : String(e));
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  console.warn('Farasa diacritize: all URLs exhausted');
  return null;
}

// Fallback: use Qwen + Gemini via OpenRouter for translation when needed
async function lovableAITranslate(arabicLines: string[], apiKey: string, dialect?: string): Promise<string[]> {
  const numberedLines = arabicLines.map((line, i) => `${i + 1}. ${line}`).join('\n');
  const dialectNote = dialect ? getDialectNote(dialect, ' ') : '';
  const messages = [
    {
      role: "system",
      content: `You are an expert translator specializing in Gulf Arabic (Khaliji) dialect.${dialectNote} Translate each numbered Arabic line to natural English. Return ONLY the translations, numbered to match. No commentary.`,
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
      callModel('qwen/qwen3-235b-a22b'),
      callModel('google/gemini-2.5-flash'),
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
    const { transcript, munsitTranscript, fanarTranscript, visualContext } = body;

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

    const RUNPOD_API_KEY = Deno.env.get('RUNPOD_API_KEY');
    const RUNPOD_JAIS_ENDPOINT = 'https://api.runpod.ai/v2/xx0wek543611i5/openai/v1/chat/completions';
    const RUNPOD_FALCON_ENDPOINT = 'https://api.runpod.ai/v2/tnhfklb3tb7md8/openai/v1/chat/completions';
    const jaisAvailable = Boolean(RUNPOD_API_KEY);
    const falconAvailable = Boolean(RUNPOD_API_KEY);

     let partial = false;

     // Build user content for the merge prompt (all available ASR transcripts)
     const linesUserContent = hasTriple
       ? `Transcription A (Deepgram):\n${transcript}\n\nTranscription B (Munsit):\n${munsitTranscript}\n\nTranscription C (Fanar):\n${fanarTranscript}`
       : hasDual
       ? `Transcription A (Deepgram):\n${transcript}\n\nTranscription B (Munsit):\n${munsitTranscript}`
       : hasFanar
       ? `Transcription A (Deepgram):\n${transcript}\n\nTranscription B (Fanar):\n${fanarTranscript}`
       : transcript;

     const hasDualOrTriple = hasDual || hasFanar;

     // =====================================================================
     // CALL 1 — Transcript merging only
     // Send all ASR transcripts to Qwen. Produce merged Arabic lines only.
     // No translations. No vocabulary. No grammar. Just the merged text.
     // Fanar runs in parallel as a fallback merge source.
     // =====================================================================
     console.log('Call 1: merging ASR transcripts into clean Arabic lines...');

     let mergeOnlyAi: MergeOnlyAI | null = null;

     const [mergeResp, fanarMergeResp] = await Promise.all([
       callAI({
         systemPrompt: getMergeOnlySystemPrompt(false, hasDualOrTriple, hasTriple),
         userContent: linesUserContent,
         apiKey: OPENROUTER_API_KEY,
         isRetry: false,
         maxTokens: 8192,
       }),
       fanarLlmAvailable
         ? callFanar({
             systemPrompt: getMergeOnlySystemPrompt(false, hasDualOrTriple, hasTriple),
             userContent: linesUserContent,
             apiKey: FANAR_API_KEY!,
             maxTokens: 8192,
           })
         : Promise.resolve({ content: null } as { content: string | null }),
     ]);

     // Check for fatal errors from Qwen Call 1
     if (!mergeResp.content && mergeResp.status) {
       if (mergeResp.status === 429) {
         return new Response(
           JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
           { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
         );
       }
       if (mergeResp.status === 402) {
         return new Response(
           JSON.stringify({ error: 'AI credits exhausted. Please add credits to continue.' }),
           { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
         );
       }
     }

     if (mergeResp.content) {
       mergeOnlyAi = safeJsonParse<MergeOnlyAI>(mergeResp.content);
     }

     // Fallback to Fanar if Qwen Call 1 parse failed
     if (!mergeOnlyAi?.lines || mergeOnlyAi.lines.length === 0) {
       if (fanarMergeResp.content) {
         const fanarMergeAi = safeJsonParse<MergeOnlyAI>(fanarMergeResp.content);
         if (fanarMergeAi?.lines && fanarMergeAi.lines.length > 0) {
           console.log('Qwen Call 1 parse failed, using Fanar merge result');
           mergeOnlyAi = fanarMergeAi;
         }
       }
     }

     // Retry Qwen Call 1 with stricter prompt if still failed
     if (!mergeOnlyAi?.lines || mergeOnlyAi.lines.length === 0) {
       console.log('Call 1 parse failed, retrying with stricter prompt...');
       const mergeRetry = await callAI({
         systemPrompt: getMergeOnlySystemPrompt(true, hasDualOrTriple, hasTriple),
         userContent: linesUserContent,
         apiKey: OPENROUTER_API_KEY,
         isRetry: true,
         maxTokens: 8192,
       });
       if (mergeRetry.content) {
         mergeOnlyAi = safeJsonParse<MergeOnlyAI>(mergeRetry.content);
       }
     }

     // If Call 1 fails entirely — do NOT attempt Call 2
     if (!mergeOnlyAi?.lines || !Array.isArray(mergeOnlyAi.lines) || mergeOnlyAi.lines.length === 0) {
       console.error('Call 1 failed: could not produce merged transcript. Skipping Call 2.');
       partial = true;
       const fallback = createFallbackResult(transcript);
       return new Response(
         JSON.stringify({ success: true, result: fallback, partial }),
         { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
       );
     }

     // Store the merged transcript from Call 1
     const mergedLines = mergeOnlyAi.lines;
     const detectedDialect = mergeOnlyAi.dialect ?? 'Gulf';
     console.log('Call 1 complete:', mergedLines.length, 'merged Arabic lines. Detected dialect:', detectedDialect);

     // Build numbered merged transcript text to feed into translation and Call 2
     const mergedTranscriptText = mergedLines
       .map((l, i) => `${i + 1}. ${l.arabic}`)
       .join('\n');

     // =====================================================================
     // TRANSLATION — Gemini 2.5 Flash (primary) / Qwen (fallback)
     // Receives the merged transcript from Call 1.
     // Produces per-line English translations only — separate from analysis.
     //
     // CALL 2 — Analysis and enrichment (vocabulary + grammar)
     // Receives the same merged transcript from Call 1.
     // Produces vocabulary, grammar points, and cultural context.
     //
     // CAMEL DIALECT ID — CAMeL-Lab BERT model via Hugging Face Inference API.
     // Identifies Gulf dialect at city level (Kuwait/Doha/Riyadh/Abu Dhabi/etc.)
     // independently of the LLM. Runs in parallel — result enriches the response
     // and validates the LLM-detected dialect. Never blocks the pipeline.
     //
     // FARASA DIACRITIZE — QCRI Farasa REST API adds tashkeel to merged Arabic.
     // Diacritized text is returned in the result for ElevenLabs TTS calls.
     //
     // All run in parallel. Translation is a separate concern from analysis.
     // =====================================================================
     console.log('Translation (Gemini), analysis (Qwen), meta (Fanar+Jais+Falcon), CAMeL dialect, Farasa diac running in parallel...');

     const arabicOnlyText = mergedLines.map(l => l.arabic).join('\n');
     const hfApiKey = Deno.env.get('HUGGINGFACE_API_KEY') ?? '';

      const [geminiTransResp, analysisResp, fanarMetaResp, fanarValidResp, jaisMetaResp, falconMetaResp, camelDialectResult, diacritizedTranscript] = await Promise.all([
        // Translation primary: Gemini 2.5 Pro via Lovable AI gateway
        callAI({
          model: 'google/gemini-2.5-pro',
          systemPrompt: getTranslationSystemPrompt(detectedDialect, visualContext),
          userContent: mergedTranscriptText,
          apiKey: '', // not used for lovable gateway
          gateway: 'lovable',
          maxTokens: 16384,
        }),
       // Call 2: vocabulary + grammar (Qwen, unchanged from Step 2)
       callAI({
         systemPrompt: getAnalysisSystemPrompt(false, detectedDialect),
         userContent: mergedTranscriptText,
         apiKey: OPENROUTER_API_KEY,
         isRetry: false,
         maxTokens: 8192,
       }),
       // Fanar-Sadiq meta enrichment (unchanged)
       fanarLlmAvailable
         ? callFanar({
             systemPrompt: getMetaSystemPrompt(true),
             userContent: mergedTranscriptText,
             apiKey: FANAR_API_KEY!,
             model: 'Fanar-Sadiq',
             maxTokens: 2048,
           })
         : Promise.resolve({ content: null } as { content: string | null }),
       // Fanar-C-2-27B dialect validation — read-only, never blocks pipeline
       // Fanar-Sadiq is RAG/knowledge-base only — it returns "no info in my KB"
       // for linguistic analysis tasks. Fanar-C-2-27B is the general chat model.
       fanarLlmAvailable
         ? callFanar({
             systemPrompt: getFanarValidationSystemPrompt(),
             userContent: mergedTranscriptText,
             apiKey: FANAR_API_KEY!,
             model: 'Fanar-C-2-27B',
             maxTokens: 1024,
           }).catch((e) => {
             console.warn('Fanar dialect validation failed (non-blocking):', e);
             return { content: null } as { content: string | null };
           })
         : Promise.resolve({ content: null } as { content: string | null }),
       // Jais meta enrichment via RunPod — Arabic-first model for grammar points and cultural context
       jaisAvailable
         ? callRunPodModel(RUNPOD_JAIS_ENDPOINT, 'inceptionai/Jais-2-8B-Chat', getMetaSystemPrompt(true), mergedTranscriptText, RUNPOD_API_KEY!, 2048).catch((e) => {
             console.warn('Jais meta enrichment failed (non-blocking):', e);
             return { content: null } as { content: string | null };
           })
         : Promise.resolve({ content: null } as { content: string | null }),
       // Falcon H1 meta enrichment via RunPod — runs in parallel for vocab/grammar/cultural context.
       // Previously Falcon only fired as a 3rd-level translation fallback (after Gemini+Qwen),
       // meaning it almost never ran. Now it contributes meta enrichment alongside Jais.
       falconAvailable
         ? callRunPodModel(RUNPOD_FALCON_ENDPOINT, 'tiiuae/Falcon-H1R-7B', getMetaSystemPrompt(true), mergedTranscriptText, RUNPOD_API_KEY!, 2048).catch((e) => {
             console.warn('Falcon meta enrichment failed (non-blocking):', e);
             return { content: null } as { content: string | null };
           })
         : Promise.resolve({ content: null } as { content: string | null }),
       // CAMeL-Lab BERT dialect ID — validates/confirms the LLM-detected dialect.
       // Uses the MADAR-Twitter model: city-level (Kuwait/Doha/Riyadh/Abu Dhabi/…).
       // Non-blocking: any failure returns null and the pipeline continues.
       hfApiKey
         ? callCamelDialect(arabicOnlyText, hfApiKey).catch((e) => {
             console.warn('CAMeL dialect call failed (non-blocking):', e);
             return null;
           })
         : Promise.resolve(null),
       // Farasa diacritize — adds short vowels (tashkeel) to the merged Arabic.
       // The result is stored in diacritizedTranscript for ElevenLabs TTS calls.
       callFarasaDiacritize(arabicOnlyText).catch((e) => {
         console.warn('Farasa diacritize failed (non-blocking):', e);
         return null;
       }),
     ]);

     // --- Log CAMeL dialect result vs LLM-detected dialect ---
     if (camelDialectResult) {
       const agreement = camelDialectResult.dialect === detectedDialect ? 'agree' : 'disagree';
       console.log(
         `CAMeL dialect: ${camelDialectResult.dialect} (${camelDialectResult.code}, conf=${camelDialectResult.confidence})` +
         ` — LLM: ${detectedDialect} — ${agreement}`,
       );
     } else {
       console.log('CAMeL dialect: unavailable (no HF key or model cold start)');
     }
     if (diacritizedTranscript) {
       console.log(`Farasa diacritize: ${diacritizedTranscript.length} chars of tashkeel-annotated Arabic`);
     }

     // --- Parse Fanar dialect validation — accept JSON or raw text, never throw ---
     let dialectValidation: { content: string; timestamp: string } | null = null;
     if (fanarValidResp?.content) {
       dialectValidation = {
         content: fanarValidResp.content,
         timestamp: new Date().toISOString(),
       };
       console.log('Fanar dialect validation received (first 150 chars):', fanarValidResp.content.slice(0, 150));
     }

     // --- Parse Gemini translation result ---
     let translationAi: TranslationAI | null = null;
     if (geminiTransResp.content) {
       translationAi = safeJsonParse<TranslationAI>(geminiTransResp.content);
       if (translationAi?.translations) {
         console.log('Gemini translation: parsed', translationAi.translations.length, 'lines.');
       }
     }

     // --- Fallback: Qwen translation-only call if Gemini failed or returned empty ---
     if (!translationAi?.translations || translationAi.translations.length === 0) {
       console.log('Gemini translation failed or empty, falling back to Qwen for translation...');
       const qwenTransResp = await callAI({
         systemPrompt: getTranslationSystemPrompt(detectedDialect, visualContext),
         userContent: mergedTranscriptText,
         apiKey: OPENROUTER_API_KEY,
         maxTokens: 4096,
       });
       if (qwenTransResp.content) {
         translationAi = safeJsonParse<TranslationAI>(qwenTransResp.content);
         if (translationAi?.translations) {
           console.log('Qwen translation fallback: parsed', translationAi.translations.length, 'lines.');
         }
       }
     }

     // --- Fallback: Falcon via RunPod if both Gemini and Qwen failed ---
     if ((!translationAi?.translations || translationAi.translations.length === 0) && falconAvailable) {
       console.log('Qwen translation failed or empty, falling back to Falcon via RunPod for translation...');
       const falconTransResp = await callRunPodModel(
         RUNPOD_FALCON_ENDPOINT,
         'tiiuae/Falcon-H1R-7B',
         getTranslationSystemPrompt(detectedDialect, visualContext),
         mergedTranscriptText,
         RUNPOD_API_KEY!,
         4096,
       ).catch((e) => {
         console.warn('Falcon RunPod translation fallback failed (non-blocking):', e);
         return { content: null };
       });
       if (falconTransResp.content) {
         translationAi = safeJsonParse<TranslationAI>(falconTransResp.content);
         if (translationAi?.translations) {
           console.log('Falcon RunPod translation fallback: parsed', translationAi.translations.length, 'lines.');
         }
       }
     }

     const dedicatedTranslations = translationAi?.translations ?? [];
     if (dedicatedTranslations.length === 0) {
       console.warn('Translation call produced no results; will use Call 2 embedded translations as last resort.');
     }

     // --- Parse Call 2 (analysis) result ---
     let analysisAi: AnalysisAI | null = null;
     if (analysisResp.content) {
       analysisAi = safeJsonParse<AnalysisAI>(analysisResp.content);
     }

     // Retry Call 2 with stricter prompt if parse fails
     if (!analysisAi?.lines || analysisAi.lines.length === 0) {
       console.log('Call 2 parse failed, retrying with stricter prompt...');
       const analysisRetry = await callAI({
         systemPrompt: getAnalysisSystemPrompt(true, detectedDialect),
         userContent: mergedTranscriptText,
         apiKey: OPENROUTER_API_KEY,
         isRetry: true,
         maxTokens: 8192,
       });
       if (analysisRetry.content) {
         analysisAi = safeJsonParse<AnalysisAI>(analysisRetry.content);
       }
     }

     if (!analysisAi) {
       partial = true;
     }

     // Always use mergedLines (Call 1 output) as the authoritative Arabic source.
     // Call 2 provides translations (secondary fallback) + vocab + grammar only.
     const call2Lines = analysisAi?.lines ?? [];
     if (analysisAi && call2Lines.length < mergedLines.length) {
       console.warn(
         `Call 2 returned ${call2Lines.length} lines but Call 1 produced ${mergedLines.length}. Using Call 1 lines as authoritative Arabic source.`
       );
     }
     let vocab = Array.isArray(analysisAi?.vocabulary) ? analysisAi!.vocabulary : [];
     let grammarPoints = Array.isArray(analysisAi?.grammarPoints) ? analysisAi!.grammarPoints : [];
     let culturalContext = analysisAi?.culturalContext;

     // Build finalLines from mergedLines — always has the correct count.
     // Translation priority: dedicated Gemini/Qwen > Call 2 embedded > empty string.
     let finalLines = mergedLines.map((mergedLine, i) => ({
       arabic: mergedLine.arabic,
       translation: dedicatedTranslations[i] || call2Lines[i]?.translation || '',
     }));

     if (dedicatedTranslations.length > 0) {
       console.log(
         'Applied dedicated translations to',
         dedicatedTranslations.length,
         'lines.',
         geminiTransResp.content && translationAi ? '(Gemini)' : '(Qwen fallback)'
       );
     }

     // Merge Fanar-Sadiq meta results if available
     if (fanarMetaResp.content) {
       const fanarMetaAi = safeJsonParse<MetaAI>(fanarMetaResp.content);
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
     }

     // Merge Jais meta results if available
     if (jaisMetaResp.content) {
       const jaisMetaAi = safeJsonParse<MetaAI>(jaisMetaResp.content);
       if (jaisMetaAi) {
         console.log('Merging Jais meta results...');
         // Union vocabularies (deduplicate by Arabic text)
         if (Array.isArray(jaisMetaAi.vocabulary)) {
           const existingArabic = new Set(vocab.map(v => v.arabic));
           const newVocab = jaisMetaAi.vocabulary.filter(v => v.arabic && !existingArabic.has(v.arabic));
           if (newVocab.length > 0) {
             vocab = [...vocab, ...newVocab];
             console.log(`Added ${newVocab.length} vocab items from Jais`);
           }
         }
         // Union grammar points (deduplicate by title)
         if (Array.isArray(jaisMetaAi.grammarPoints)) {
           const existingTitles = new Set(grammarPoints.map(g => g.title.toLowerCase()));
           const newGrammar = jaisMetaAi.grammarPoints.filter(g => g.title && !existingTitles.has(g.title.toLowerCase()));
           if (newGrammar.length > 0) {
             grammarPoints = [...grammarPoints, ...newGrammar];
             console.log(`Added ${newGrammar.length} grammar points from Jais`);
           }
         }
         // Prefer Jais cultural context if richer (longer)
         if (jaisMetaAi.culturalContext && (!culturalContext || jaisMetaAi.culturalContext.length > culturalContext.length)) {
           culturalContext = jaisMetaAi.culturalContext;
           console.log('Using Jais cultural context (richer)');
         }
       }
     }

     // Merge Falcon H1 meta results if available
     if (falconMetaResp.content) {
       const falconMetaAi = safeJsonParse<MetaAI>(falconMetaResp.content);
       if (falconMetaAi) {
         console.log('Merging Falcon H1 meta results...');
         if (Array.isArray(falconMetaAi.vocabulary)) {
           const existingArabic = new Set(vocab.map(v => v.arabic));
           const newVocab = falconMetaAi.vocabulary.filter(v => v.arabic && !existingArabic.has(v.arabic));
           if (newVocab.length > 0) {
             vocab = [...vocab, ...newVocab];
             console.log(`Added ${newVocab.length} vocab items from Falcon H1`);
           }
         }
         if (Array.isArray(falconMetaAi.grammarPoints)) {
           const existingTitles = new Set(grammarPoints.map(g => g.title.toLowerCase()));
           const newGrammar = falconMetaAi.grammarPoints.filter(g => g.title && !existingTitles.has(g.title.toLowerCase()));
           if (newGrammar.length > 0) {
             grammarPoints = [...grammarPoints, ...newGrammar];
             console.log(`Added ${newGrammar.length} grammar points from Falcon H1`);
           }
         }
         if (falconMetaAi.culturalContext && (!culturalContext || falconMetaAi.culturalContext.length > culturalContext.length)) {
           culturalContext = falconMetaAi.culturalContext;
           console.log('Using Falcon H1 cultural context (richer)');
         }
       }
     }

     // ── Step 5: Claude Sonnet vocabulary enrichment ──────────────────────────
     // Runs after full vocab assembly (Qwen + Fanar + Jais + Falcon union). Sequential.
     // Non-blocking: any failure leaves vocab unchanged.
     if (vocab.length > 0) {
       try {
         const vocabPayload = JSON.stringify(vocab.map(v => ({ arabic: v.arabic, english: v.english, root: v.root })));
         const claudeEnrichResp = await callAI({
           model: 'anthropic/claude-sonnet-4-5',
           systemPrompt: getVocabEnrichmentSystemPrompt(),
           userContent: `Vocabulary list to enrich:\n${vocabPayload}`,
           apiKey: OPENROUTER_API_KEY,
           maxTokens: 4096,
         });
         if (claudeEnrichResp.content) {
           const claudeEnrichAi = safeJsonParse<ClaudeEnrichmentAI>(claudeEnrichResp.content);
           if (claudeEnrichAi?.enrichments?.length) {
             const enrichmentMap = new Map(claudeEnrichAi.enrichments.map(e => [e.arabic, e]));
             vocab = vocab.map(item => {
               const enrichment = enrichmentMap.get(item.arabic);
               if (!enrichment) return item;
               const { arabic: _arabic, ...fields } = enrichment;
               return { ...item, ...fields };
             });
             console.log(`Claude enriched ${enrichmentMap.size} vocab items.`);
           }
         }
       } catch (e) {
         console.warn('Claude vocab enrichment failed (non-blocking):', e);
       }
     }

     // Build the final TranscriptResult
     // Token glosses come from vocabulary items and the COMMON_GLOSSES fallback dictionary.
     const transcriptResult: TranscriptResult = {
       rawTranscriptArabic: transcript,
       lines: finalLines.map((l, idx) => ({
         id: `line-${generateId()}-${idx}`,
         arabic: String(l.arabic ?? '').trim(),
         translation: String(l.translation ?? '').trim(),
         tokens: toWordTokens(String(l.arabic ?? '').trim(), vocab, {}),
       })),
       vocabulary: vocab,
       grammarPoints,
       culturalContext,
       dialectValidation,
       dialect: detectedDialect,
       diacritizedTranscript: diacritizedTranscript ?? null,
       camelDialect: camelDialectResult ?? null,
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
