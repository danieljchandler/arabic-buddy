 import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
 
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
const getLinesSystemPrompt = (isRetry: boolean = false) => {
  const strictPrefix = strictJsonPrefix(isRetry);
  return `${strictPrefix}You are processing Gulf Arabic transcript text for language learners.

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
  return `${strictPrefix}You are a Gulf Arabic linguist providing word-by-word English glosses for language learners.

Output ONLY valid JSON matching this schema:
{
  "glosses": {
    "arabicWord": "english meaning",
    ...
  }
}

Rules:
- Provide an English gloss for EVERY unique Arabic word in the transcript.
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
      response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Gemini tends to follow "return ONLY JSON" well, and now our schema is small enough
          // to avoid truncation.
          model: 'google/gemini-2.5-flash',
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
  'في': 'there is/in',
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
  'بـ': 'will',
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
  
  const words = arabic.split(/\s+/).filter(Boolean);

  return words.map((surface, idx) => {
    const stripped = stripDiacritics(surface);
    
    // Priority: exact vocab > exact AI gloss > stripped vocab > stripped AI gloss > common fallback
    const gloss = 
      vocabMap.get(surface) ?? 
      wordGlosses[surface] ?? 
      vocabMapStripped.get(stripped) ?? 
      wordGlossesStripped[stripped] ??
      COMMON_GLOSSES[surface] ??
      COMMON_GLOSSES[stripped];
      
    return {
      id: `tok-${generateId()}-${idx}`,
      surface,
      gloss,
    };
  });
}

type LinesAI = {
  lines: Array<{ arabic: string; translation: string }>;
};

type MetaAI = {
  vocabulary: VocabItem[];
  grammarPoints: GrammarPoint[];
  culturalContext?: string;
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { transcript } = await req.json();

    if (!transcript || typeof transcript !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid transcript' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

     console.log('Analyzing transcript (lines + meta)...');
     console.log('Transcript length:', transcript.length);

     let partial = false;

     // -----------------------------
     // 1) Sentence split + translation
     // -----------------------------
     let linesAi: LinesAI | null = null;

     let linesResp = await callAI({
       systemPrompt: getLinesSystemPrompt(false),
       userContent: transcript,
       apiKey: LOVABLE_API_KEY,
       isRetry: false,
       // Lines can be the largest part of the response.
       maxTokens: 8192,
     });

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

     if (!linesAi?.lines || !Array.isArray(linesAi.lines) || linesAi.lines.length === 0) {
       console.log('Lines parse failed, retrying with stricter prompt...');
       const retry = await callAI({
         systemPrompt: getLinesSystemPrompt(true),
         userContent: transcript,
         apiKey: LOVABLE_API_KEY,
         isRetry: true,
         maxTokens: 8192,
       });
       if (retry.content) {
         linesAi = safeJsonParse<LinesAI>(retry.content);
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
           apiKey: LOVABLE_API_KEY,
           isRetry: false,
           maxTokens: 2048,
         });
         let metaAi = metaResp.content ? safeJsonParse<MetaAI>(metaResp.content) : null;
         if (!metaAi) {
           const metaRetry = await callAI({
             systemPrompt: getMetaSystemPrompt(true),
             userContent: transcript,
             apiKey: LOVABLE_API_KEY,
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
     // 2) Vocabulary + grammar + culture (small JSON)
     // -----------------------------
     let metaAi: MetaAI | null = null;
     let metaResp = await callAI({
       systemPrompt: getMetaSystemPrompt(false),
       userContent: transcript,
       apiKey: LOVABLE_API_KEY,
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
         apiKey: LOVABLE_API_KEY,
         isRetry: true,
         maxTokens: 2048,
       });
       if (metaRetry.content) {
         metaAi = safeJsonParse<MetaAI>(metaRetry.content);
       }
     }
     if (!metaAi) {
       partial = true;
       metaAi = { vocabulary: [], grammarPoints: [] };
     }

     const vocab = Array.isArray(metaAi.vocabulary) ? metaAi.vocabulary : [];
     const grammarPoints = Array.isArray(metaAi.grammarPoints) ? metaAi.grammarPoints : [];

     // -----------------------------
     // 3) Comprehensive word glosses for every word
     // -----------------------------
     let wordGlosses: Record<string, string> = {};
     
     // Extract all unique words from all lines
     const allWords = new Set<string>();
     for (const line of linesAi.lines) {
       const words = String(line.arabic ?? '').split(/\s+/).filter(Boolean);
       words.forEach(w => allWords.add(w));
     }
     
     console.log('Fetching glosses for', allWords.size, 'unique words...');
     
     let glossesResp = await callAI({
       systemPrompt: getWordGlossesPrompt(false),
       userContent: `Provide English glosses for these Gulf Arabic words:\n\n${Array.from(allWords).join(' ')}`,
       apiKey: LOVABLE_API_KEY,
       isRetry: false,
       maxTokens: 4096,
     });
     
     if (glossesResp.content) {
       const glossesAi = safeJsonParse<GlossesAI>(glossesResp.content);
       if (glossesAi?.glosses && typeof glossesAi.glosses === 'object') {
         wordGlosses = glossesAi.glosses;
         console.log('Parsed', Object.keys(wordGlosses).length, 'word glosses');
       }
     }
     
     // Retry if we got no glosses
     if (Object.keys(wordGlosses).length === 0) {
       console.log('Word glosses parse failed, retrying...');
       const glossesRetry = await callAI({
         systemPrompt: getWordGlossesPrompt(true),
         userContent: `Provide English glosses for these Gulf Arabic words:\n\n${Array.from(allWords).join(' ')}`,
         apiKey: LOVABLE_API_KEY,
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
       lines: linesAi.lines.map((l, idx) => ({
         id: `line-${generateId()}-${idx}`,
         arabic: String(l.arabic ?? '').trim(),
         translation: String(l.translation ?? '').trim(),
         tokens: toWordTokens(String(l.arabic ?? '').trim(), vocab, wordGlosses),
       })),
       vocabulary: vocab,
       grammarPoints,
       culturalContext: metaAi.culturalContext,
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
