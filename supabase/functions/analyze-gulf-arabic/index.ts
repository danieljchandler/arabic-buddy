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
   const strictPrefix = isRetry ? "CRITICAL: Return ONLY valid JSON. No commentary, no markdown, no explanation. Just the JSON object.\n\n" : "";
   
   return `${strictPrefix}You are an expert Gulf Arabic linguist analyzing spoken dialect transcripts for language learners.
 
 OUTPUT FORMAT: Return ONLY valid JSON matching this exact schema:
 {
   "rawTranscriptArabic": string,
   "lines": [{
     "id": string (e.g. "line-1", "line-2"),
     "arabic": string (full sentence as spoken),
     "translation": string (natural English translation),
     "tokens": [{
       "id": string (e.g. "line-1-tok-1"),
       "surface": string (word as spoken in dialect),
       "standard": string | null (MSA spelling if different, e.g. "كيف" for Gulf "شلون"),
       "gloss": string | null (short English meaning, 1-3 words)
     }]
   }],
   "vocabulary": [{"arabic": string, "english": string, "root": string | null}],
   "grammarPoints": [{"title": string, "explanation": string, "examples": string[]}]
 }
 
 TOKENIZATION RULES:
 1. Split transcript into natural sentence-by-sentence lines
 2. Keep dialect spelling exactly as spoken (e.g. شلون not كيف, ليش not لماذا)
 3. Provide "standard" ONLY when MSA spelling differs meaningfully from dialect
 4. Provide "gloss" for ALL content words (nouns, verbs, adjectives, key adverbs)
 5. Skip gloss for common particles (و، في، من) unless meaning is unclear
 6. Attach punctuation to the preceding word token
 
 VOCABULARY EXTRACTION:
 - Extract 5-8 key vocabulary words that are most useful for learners
 - Include trilateral roots when applicable (e.g. ك-ت-ب for كتب)
 - Focus on dialect-specific words and expressions
 
 GRAMMAR POINTS:
 - Identify 2-4 dialect-specific grammar patterns
 - Explain how Gulf Arabic differs from MSA
 - Provide 1-2 examples from the transcript
 
 EXAMPLE OUTPUT:
 {
   "rawTranscriptArabic": "شلون حالك؟ الحمد لله",
   "lines": [
     {
       "id": "line-1",
       "arabic": "شلون حالك؟",
       "translation": "How are you?",
       "tokens": [
         {"id": "line-1-tok-1", "surface": "شلون", "standard": "كيف", "gloss": "how"},
         {"id": "line-1-tok-2", "surface": "حالك؟", "standard": null, "gloss": "your condition"}
       ]
     }
   ],
   "vocabulary": [{"arabic": "شلون", "english": "how (Gulf)", "root": null}],
   "grammarPoints": [{"title": "Question word شلون", "explanation": "Gulf Arabic uses شلون instead of MSA كيف for 'how'", "examples": ["شلون حالك؟"]}]
 }
 
 NO additional text outside JSON. Return ONLY the JSON object.`;
 };
 
 async function callAI(transcript: string, apiKey: string, isRetry: boolean = false): Promise<{ content: string | null; error?: string; status?: number }> {
   const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
     method: 'POST',
     headers: {
       'Authorization': `Bearer ${apiKey}`,
       'Content-Type': 'application/json',
     },
     body: JSON.stringify({
       model: 'openai/gpt-5-mini',
       messages: [
         { role: 'system', content: getSystemPrompt(isRetry) },
         { role: 'user', content: transcript }
       ],
     }),
   });
 
   if (!response.ok) {
     const errorText = await response.text();
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
