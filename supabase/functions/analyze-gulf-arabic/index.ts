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

Rules:
- Split the ENTIRE transcript into natural sentence-by-sentence lines. Include ALL sentences.
- Do NOT summarize. Do NOT drop sentences.
- Translation must be sentence-by-sentence matching each Arabic line.
- Keep dialect spelling exactly as spoken (do NOT normalize).
- Keep punctuation as spoken.

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
 
    const data = await response.json();
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

function toWordTokens(arabic: string, vocabulary: VocabItem[]): WordToken[] {
  const vocabMap = new Map(vocabulary.map((v) => [v.arabic, v] as const));
  const words = arabic.split(/\s+/).filter(Boolean);

  return words.map((surface, idx) => {
    const match = vocabMap.get(surface);
    return {
      id: `tok-${generateId()}-${idx}`,
      surface,
      gloss: match?.english,
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
           tokens: toWordTokens(l.arabic, Array.isArray(meta.vocabulary) ? meta.vocabulary : []),
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

     // Build the full TranscriptResult
     const transcriptResult: TranscriptResult = {
       rawTranscriptArabic: transcript,
       lines: linesAi.lines.map((l, idx) => ({
         id: `line-${generateId()}-${idx}`,
         arabic: String(l.arabic ?? '').trim(),
         translation: String(l.translation ?? '').trim(),
         tokens: toWordTokens(String(l.arabic ?? '').trim(), vocab),
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
