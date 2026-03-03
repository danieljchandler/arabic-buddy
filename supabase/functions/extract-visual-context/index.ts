import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface VideoFrame {
  dataUri: string;
  timestampSeconds: number;
}

interface OnScreenTextSegment {
  text: string;
  translation: string;
  transliteration?: string;
  startSeconds: number;
  endSeconds: number;
  confidence: 'high' | 'medium' | 'low';
}

interface VisualContextResult {
  onScreenTextSegments: OnScreenTextSegment[];
  sceneContext: string;
  culturalContext: string;
  detectedDialectCues: string[];
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
    console.error('JSON parse error, content preview:', content.slice(0, 300));
    return null;
  }
}

const VISUAL_CONTEXT_PROMPT = `You are analyzing video frames from an Arabic social media video (TikTok, Instagram, YouTube Shorts) to help with transcription and translation accuracy.

Output ONLY valid JSON matching this schema:
{
  "onScreenTextSegments": [
    {
      "text": "exact text visible on screen (Arabic or Latin)",
      "translation": "English translation",
      "transliteration": "romanized pronunciation (Arabic only, omit for Latin text)",
      "startSeconds": 0.0,
      "endSeconds": 5.0,
      "confidence": "high"
    }
  ],
  "sceneContext": "1-2 sentence description of the setting and what is happening",
  "culturalContext": "Cultural notes relevant to understanding this content (empty string if nothing notable)",
  "detectedDialectCues": ["visual cues that suggest a specific Gulf country or dialect"]
}

Rules for onScreenTextSegments:
- Include ALL text overlays: POV captions (e.g. "POV: طالب في الجامعة"), subtitles, title cards, stickers, lower thirds, graphics
- "POV:" text is extremely common on TikTok/Instagram — always capture it
- Include BOTH Arabic-script text AND Latin-script text (English, romanized Arabic, etc.)
- Only include text actually visible in the frames — do not infer or guess
- Estimate timestamps based on which frame(s) the text appears in
- confidence: "high" if text is clear and readable, "medium" if partially visible, "low" if uncertain
- If the same text spans multiple consecutive frames, use a single segment with broader time range
- Exclude platform UI (like/share buttons, app chrome) and invisible watermarks

For sceneContext: describe location, number of people, activity, formal/informal tone.
For detectedDialectCues: national flags, license plates, TV channel logos, brand signs, architecture, clothing patterns, or any geographic markers suggesting a specific Gulf country.

No additional text outside JSON.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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
    const { frames, audioDuration, videoTitle } = body as {
      frames: VideoFrame[];
      audioDuration?: number;
      videoTitle?: string;
    };

    if (!Array.isArray(frames) || frames.length === 0) {
      return new Response(
        JSON.stringify({ error: 'frames array is required and must not be empty' }),
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

    // Cap frames to 15 to stay within request limits
    const cappedFrames = frames.slice(0, 15);
    console.log(`extract-visual-context: analyzing ${cappedFrames.length} frames (duration: ${audioDuration}s)`);

    // Build multimodal message: one image_url block per frame + a text block
    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

    cappedFrames.forEach((frame) => {
      const dataUri = frame.dataUri.startsWith('data:')
        ? frame.dataUri
        : `data:image/jpeg;base64,${frame.dataUri}`;
      userContent.push({ type: 'image_url', image_url: { url: dataUri } });
    });

    const durationNote = audioDuration ? ` (total duration: ${audioDuration}s)` : '';
    const titleNote = videoTitle ? ` titled "${videoTitle}"` : '';
    const timestampList = cappedFrames
      .map((f, i) => `Frame ${i + 1}: ${f.timestampSeconds}s`)
      .join(', ');

    userContent.push({
      type: 'text',
      text: `Analyze these ${cappedFrames.length} video frames from an Arabic social media video${titleNote}${durationNote}.\n\nFrame timestamps: ${timestampList}\n\nIdentify all on-screen text overlays, describe the scene, and note any cultural context or dialect cues.`,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);

    let rawResponse: string;
    try {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: VISUAL_CONTEXT_PROMPT },
            { role: 'user', content: userContent },
          ],
          max_tokens: 4096,
          temperature: 0.2,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('Gemini vision error:', response.status, errText.slice(0, 400));
        if (response.status === 402) throw new Error('AI credits exhausted');
        if (response.status === 429) throw new Error('Rate limit exceeded');
        throw new Error(`AI service error (${response.status})`);
      }

      const data = await response.json();
      rawResponse = data.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timeout);
    }

    if (!rawResponse) {
      throw new Error('AI returned empty response');
    }

    const parsed = safeJsonParse<VisualContextResult>(rawResponse);
    if (!parsed) {
      throw new Error('Failed to parse AI response');
    }

    // Normalise the result
    const result: VisualContextResult = {
      onScreenTextSegments: Array.isArray(parsed.onScreenTextSegments)
        ? parsed.onScreenTextSegments
            .filter((s: any) => s?.text && String(s.text).trim().length > 0)
            .map((s: any) => ({
              text: String(s.text).trim(),
              translation: String(s.translation ?? '').trim(),
              transliteration: s.transliteration ? String(s.transliteration).trim() : undefined,
              startSeconds: Number(s.startSeconds ?? 0),
              endSeconds: Number(s.endSeconds ?? cappedFrames[cappedFrames.length - 1]?.timestampSeconds ?? 0),
              confidence: (['high', 'medium', 'low'].includes(s.confidence) ? s.confidence : 'medium') as 'high' | 'medium' | 'low',
            }))
        : [],
      sceneContext: String(parsed.sceneContext ?? '').trim(),
      culturalContext: String(parsed.culturalContext ?? '').trim(),
      detectedDialectCues: Array.isArray(parsed.detectedDialectCues)
        ? parsed.detectedDialectCues.map(String).filter(Boolean)
        : [],
    };

    console.log(`extract-visual-context: found ${result.onScreenTextSegments.length} on-screen text segments`);

    return new Response(
      JSON.stringify({ success: true, result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('extract-visual-context error:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
