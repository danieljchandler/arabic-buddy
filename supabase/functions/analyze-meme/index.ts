import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

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

function toWordTokens(arabic: string, glosses: Record<string, string> = {}): WordToken[] {
  const words = arabic.split(/\s+/).filter(Boolean);
  return words.map((surface, idx) => ({
    id: `tok-${generateId()}-${idx}`,
    surface,
    gloss: glosses[surface],
  }));
}

async function callFalcon(
  systemPrompt: string,
  userContent: string,
  maxTokens = 4096,
): Promise<string | null> {
  const FALCON_URL = Deno.env.get('FALCON_HF_ENDPOINT_URL');
  const FALCON_KEY = Deno.env.get('FALCON_HF_API_KEY');
  if (!FALCON_URL || !FALCON_KEY) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50_000);

    const response = await fetch(`${FALCON_URL}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${FALCON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tiiuae/Falcon-H1R-7B',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn('Falcon error:', response.status);
      return null;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.warn('Falcon call failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function callAI(
  systemPrompt: string,
  userContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }>,
  apiKey: string,
  maxTokens = 4096,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  try {
    const messages: Array<{ role: string; content: string | typeof userContent }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages,
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
      throw e; // Re-throw user-facing errors
    }
    console.error('AI fetch failed:', e);
    throw new Error('AI analysis failed. Please try again.');
  } finally {
    clearTimeout(timeout);
  }
}

const MEME_ANALYSIS_PROMPT = `You are analyzing an Arabic meme (image or video frames) for Gulf Arabic language learners.

Look at ALL Arabic text visible in the image(s). Also consider any audio transcript text provided.

Output ONLY valid JSON matching this schema:
{
  "memeExplanation": {
    "casual": "string - fun, casual explanation of what's funny about this meme (2-3 sentences)",
    "cultural": "string - deeper cultural/linguistic breakdown explaining the humor, references, and dialect nuances (3-5 sentences)"
  },
  "onScreenText": {
    "rawTranscriptArabic": "string - all Arabic text visible on screen, combined",
    "lines": [
      {
        "arabic": "string - one line/segment of on-screen text",
        "translation": "string - English translation"
      }
    ],
    "vocabulary": [
      {"arabic": "string", "english": "string", "root": "string (optional)"}
    ],
    "grammarPoints": [
      {"title": "string", "explanation": "string", "examples": ["string"]}
    ]
  },
  "glosses": {
    "arabicWord": "english meaning"
  }
}

Rules:
- Read ALL Arabic text in the image carefully, including meme captions, overlaid text, watermarks with Arabic
- Keep dialect spelling as spoken (Gulf Arabic)
- Vocabulary: 3-8 useful words from the meme
- Grammar points: 1-3 dialect-specific points
- Glosses: provide English meaning for EVERY unique Arabic word found
- If there's no Arabic text visible, set rawTranscriptArabic to empty string and lines to empty array
- The casual explanation should be fun and relatable
- The cultural explanation should teach about Gulf/Arab culture, humor patterns, or linguistic features

No additional text outside JSON.`;

const AUDIO_ANALYSIS_PROMPT = `You are processing Gulf Arabic audio transcript from a meme video for language learners.

Output ONLY valid JSON matching this schema:
{
  "lines": [
    {
      "arabic": "string - one segment of spoken text",
      "translation": "string - English translation"
    }
  ],
  "vocabulary": [
    {"arabic": "string", "english": "string", "root": "string (optional)"}
  ],
  "grammarPoints": [
    {"title": "string", "explanation": "string", "examples": ["string"]}
  ],
  "glosses": {
    "arabicWord": "english meaning"
  }
}

Rules:
- Split into segments of 3-12 words each
- Keep dialect spelling as spoken
- Vocabulary: 3-6 useful words
- Grammar points: 1-2 relevant points
- Glosses: English meaning for EVERY unique Arabic word

No additional text outside JSON.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { imageBase64, audioTranscript, isVideo } = body;

    if (!imageBase64 && !audioTranscript) {
      return new Response(
        JSON.stringify({ error: 'Must provide imageBase64 or audioTranscript' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build vision content for image analysis
    let onScreenResult: any = null;
    let audioResult: any = null;

    // Analyze image(s) with vision
    if (imageBase64) {
      console.log('Analyzing meme image with vision...');

      // Support multiple frames (video) or single image
      const images = Array.isArray(imageBase64) ? imageBase64 : [imageBase64];
      
      const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
      
      images.forEach((img: string, idx: number) => {
        // Ensure proper data URI format
        const dataUri = img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`;
        userContent.push({
          type: 'image_url',
          image_url: { url: dataUri },
        });
      });

      if (audioTranscript) {
        userContent.push({
          type: 'text',
          text: `Analyze the Arabic meme in these ${images.length > 1 ? 'video frames' : 'image'}. Also, here is the audio transcript from the video:\n\n${audioTranscript}`,
        });
      } else {
        userContent.push({
          type: 'text',
          text: `Analyze the Arabic meme in ${images.length > 1 ? 'these video frames' : 'this image'}. Read all Arabic text visible and explain the humor.`,
        });
      }

      const rawResponse = await callAI(MEME_ANALYSIS_PROMPT, userContent, LOVABLE_API_KEY, 6000);
      onScreenResult = safeJsonParse<any>(rawResponse);
      
      if (!onScreenResult) {
        throw new Error('Failed to parse AI response. Please try again.');
      }
    }

    // If we have audio transcript but no image analysis, or need separate audio analysis
    if (audioTranscript && !imageBase64) {
      console.log('Analyzing audio transcript...');
      // Try Falcon first for text-only analysis, fall back to Lovable AI
      const falconResult = await callFalcon(AUDIO_ANALYSIS_PROMPT, audioTranscript, 4096);
      const rawResponse = falconResult || await callAI(AUDIO_ANALYSIS_PROMPT, audioTranscript, LOVABLE_API_KEY, 4096);
      audioResult = safeJsonParse<any>(rawResponse);
    }

    // Build the final structured result
    const result: any = {
      memeExplanation: onScreenResult?.memeExplanation ?? { casual: '', cultural: '' },
      onScreenText: {
        rawTranscriptArabic: onScreenResult?.onScreenText?.rawTranscriptArabic ?? '',
        lines: [] as TranscriptLine[],
        vocabulary: [] as VocabItem[],
        grammarPoints: [] as GrammarPoint[],
      },
    };

    // Process on-screen text lines with tokens
    const onScreenGlosses = onScreenResult?.glosses ?? {};
    if (onScreenResult?.onScreenText?.lines) {
      result.onScreenText.lines = onScreenResult.onScreenText.lines.map((l: any, idx: number) => ({
        id: `line-${generateId()}-${idx}`,
        arabic: String(l.arabic ?? ''),
        translation: String(l.translation ?? ''),
        tokens: toWordTokens(String(l.arabic ?? ''), onScreenGlosses),
      }));
    }

    if (onScreenResult?.onScreenText?.vocabulary) {
      result.onScreenText.vocabulary = onScreenResult.onScreenText.vocabulary
        .filter((v: any) => v?.arabic)
        .map((v: any) => ({
          arabic: String(v.arabic),
          english: String(v.english ?? ''),
          root: v.root ? String(v.root) : undefined,
        }));
    }

    if (onScreenResult?.onScreenText?.grammarPoints) {
      result.onScreenText.grammarPoints = onScreenResult.onScreenText.grammarPoints
        .filter((g: any) => g?.title)
        .map((g: any) => ({
          title: String(g.title),
          explanation: String(g.explanation ?? ''),
          examples: Array.isArray(g.examples) ? g.examples.map(String) : undefined,
        }));
    }

    // Process audio transcript if separate
    if (audioResult) {
      const audioGlosses = audioResult.glosses ?? {};
      result.audioText = {
        rawTranscriptArabic: audioResult.lines?.map((l: any) => l.arabic).join(' ') ?? '',
        lines: (audioResult.lines ?? []).map((l: any, idx: number) => ({
          id: `audio-line-${generateId()}-${idx}`,
          arabic: String(l.arabic ?? ''),
          translation: String(l.translation ?? ''),
          tokens: toWordTokens(String(l.arabic ?? ''), audioGlosses),
        })),
        vocabulary: (audioResult.vocabulary ?? [])
          .filter((v: any) => v?.arabic)
          .map((v: any) => ({
            arabic: String(v.arabic),
            english: String(v.english ?? ''),
            root: v.root ? String(v.root) : undefined,
          })),
        grammarPoints: (audioResult.grammarPoints ?? [])
          .filter((g: any) => g?.title)
          .map((g: any) => ({
            title: String(g.title),
            explanation: String(g.explanation ?? ''),
            examples: Array.isArray(g.examples) ? g.examples.map(String) : undefined,
          })),
      };
    }

    console.log('Meme analysis complete:', {
      hasExplanation: !!result.memeExplanation.casual,
      onScreenLines: result.onScreenText.lines.length,
      hasAudio: !!result.audioText,
    });

    return new Response(
      JSON.stringify({ success: true, result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('analyze-meme error:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
