 import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
 
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

  const getSystemPrompt = (isRetry: boolean = false) => {
    const strictPrefix = isRetry
      ? "CRITICAL: Return ONLY valid JSON. No commentary, no markdown, no explanation. Just the JSON object.\n\n"
      : "";

    return `${strictPrefix}You are processing Gulf Arabic transcript text for language learners.

Output ONLY valid JSON matching this schema:
{
  "rawTranscriptArabic": string,
  "lines": [{
    "id": string,
    "arabic": string,
    "translation": string,
    "tokens": [{
      "id": string,
      "surface": string,
      "standard"?: string,
      "gloss"?: string
    }]
  }],
  "vocabulary": [{"arabic": string, "english": string, "root"?: string}],
  "grammarPoints": [{"title": string, "explanation": string, "examples"?: string[]}]
}

Rules:
- Split the ENTIRE transcript into natural sentence-by-sentence lines. Include ALL sentences from the transcript, not a summary or subset.
- Do NOT limit or truncate the number of lines. If the transcript has 20 sentences, output 20 lines.
- Translation must be sentence-by-sentence matching each Arabic line.
- Keep dialect spelling exactly as spoken (do NOT normalize).
- Tokens must preserve spoken form in surface.
- Provide standard only when an MSA spelling is clearly different and helpful.
- Provide gloss for content words (verbs/nouns/adjectives); skip if unsure.
- Keep punctuation attached to the preceding word.
- Vocabulary: 5–8 useful words with English meaning and root when applicable.
- GrammarPoints: 2–4 dialect-specific points with brief examples from the transcript.

No additional text outside JSON.`;
  };
 
  async function callAI(
    transcript: string,
    apiKey: string,
    isRetry: boolean = false,
  ): Promise<{ content: string | null; error?: string; status?: number }> {
    const controller = new AbortController();
    // Keep under typical serverless limits; prevents UI from hanging indefinitely.
    const timeoutMs = 25_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

       // Estimate output tokens needed: ~10 tokens per sentence, assume ~50 sentences max
       // Plus vocabulary, grammar, etc. Request generous output limit.
       const maxOutputTokens = 8192;
 
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
          // Use gemini-2.5-flash for better output handling and longer context
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: getSystemPrompt(isRetry) },
            { role: 'user', content: transcript },
          ],
          max_tokens: maxOutputTokens,
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
 
 function parseAIResponse(content: string): TranscriptResult | null {
   // Clean the response in case there's any markdown formatting
   const cleanedContent = content
     .replace(/```json\n?/g, '')
     .replace(/```\n?/g, '')
     .trim();
   
   try {
     const parsed = JSON.parse(cleanedContent);
     
     // Validate structure
     if (!parsed.lines || !Array.isArray(parsed.lines)) {
       console.error('Missing or invalid lines array');
       return null;
     }
     
     return parsed as TranscriptResult;
   } catch (e) {
     console.error('JSON parse error:', e);
     return null;
   }
 }

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

     console.log('Sending transcript to GPT-5-mini for structured analysis...');
    console.log('Transcript length:', transcript.length);

     // First attempt
     let result = await callAI(transcript, LOVABLE_API_KEY, false);
     
     if (!result.content && result.status) {
       if (result.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
       if (result.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add credits to continue.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
         JSON.stringify({ error: 'AI analysis failed', details: result.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

     if (!result.content) {
       console.error('No content in AI response');
      return new Response(
        JSON.stringify({ error: 'No analysis returned from AI' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

     console.log('Raw AI response (first 500 chars):', result.content.substring(0, 500));

     // Try to parse the response
     let analysis = parseAIResponse(result.content);
     
     // If parsing fails, retry with stricter prompt
     if (!analysis) {
       console.log('First parse failed, retrying with stricter prompt...');
       
       result = await callAI(transcript, LOVABLE_API_KEY, true);
       
       if (!result.content) {
         return new Response(
           JSON.stringify({ error: 'AI retry failed', details: result.error }),
           { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
         );
       }
       
       console.log('Retry AI response (first 500 chars):', result.content.substring(0, 500));
       analysis = parseAIResponse(result.content);
       
       if (!analysis) {
         console.error('Failed to parse AI response after retry');
         return new Response(
           JSON.stringify({ 
             error: 'Failed to parse AI analysis after retry', 
             rawContent: result.content 
           }),
           { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
         );
       }
    }

     // Build the full TranscriptResult
     const transcriptResult: TranscriptResult = {
       rawTranscriptArabic: transcript,
       lines: analysis.lines || [],
       vocabulary: analysis.vocabulary || [],
       grammarPoints: analysis.grammarPoints || [],
       culturalContext: analysis.culturalContext,
     };
 
     console.log('Analysis complete:', transcriptResult.lines.length, 'lines,', transcriptResult.vocabulary.length, 'vocab items');

    return new Response(
       JSON.stringify({ success: true, result: transcriptResult }),
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
