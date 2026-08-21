import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  ON_SCREEN_TEXT_PROMPT,
  buildVisualContextText,
  normalizeOnScreenSegments,
  toVisualTimeline,
  type OnScreenSegment,
} from "../_shared/onScreenText.ts";


interface VideoFrame {
  dataUri: string;
  timestampSeconds: number;
}

interface VisualContextResult {
  onScreenTextSegments: OnScreenSegment[];
  sceneContext: string;
  culturalContext: string;
  detectedDialectCues: string[];
}

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

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

// The OCR instruction lives in _shared/onScreenText.ts so this pass and the
// whole-video re-read ask for the same shape and the same rules.
const VISUAL_CONTEXT_PROMPT = ON_SCREEN_TEXT_PROMPT;

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
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
    const { frames, audioDuration, videoTitle, videoId, kickoffProcessing } = body as {
      frames: VideoFrame[];
      audioDuration?: number;
      videoTitle?: string;
      videoId?: string;
      kickoffProcessing?: boolean;
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

    // Keep the full client sample set. Meme punchlines/captions often appear
    // on the final frame, so do not silently drop the end sample.
    const cappedFrames = frames.slice(0, 16);
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
      // "video", not "meme": this now runs for every uploaded video file, and
      // telling the model to expect a meme on an ordinary clip invites it to
      // find a joke that is not there.
      text: `Analyze these ${cappedFrames.length} sampled frames from an Arabic social media video${titleNote}${durationNote}.\n\nFrame timestamps: ${timestampList}\n\nPrimary task: OCR every visible on-screen text overlay. Secondary task: describe only visible scene facts. Do not explain the joke or infer context beyond what is visible in these frames.`,
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
      onScreenTextSegments: normalizeOnScreenSegments(
        parsed.onScreenTextSegments,
        cappedFrames[cappedFrames.length - 1]?.timestampSeconds ?? 0,
      ),
      sceneContext: String(parsed.sceneContext ?? '').trim(),
      culturalContext: String(parsed.culturalContext ?? '').trim(),
      detectedDialectCues: Array.isArray(parsed.detectedDialectCues)
        ? parsed.detectedDialectCues.map(String).filter(Boolean)
        : [],
    };

    console.log(`extract-visual-context: found ${result.onScreenTextSegments.length} on-screen text segments`);

    let processingQueued = false;
    if (videoId) {
      const { data: isAdmin, error: adminError } = await supabaseAuth.rpc('is_admin');
      if (adminError || !isAdmin) {
        return new Response(JSON.stringify({ error: 'Admin access required' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const admin = createClient(supabaseUrl, serviceRoleKey);

      await admin.storage
        .from('video-audio')
        .upload(`${videoId}.visual.json`, JSON.stringify(result), {
          contentType: 'application/json',
          upsert: true,
        });

      const visualCulturalContext = buildVisualContextText(
        result.onScreenTextSegments,
        result.sceneContext,
        result.culturalContext,
      );

      // The same findings, with their timings kept. `cultural_context` is one
      // prose blob — it can tell the AI tutor that a video contains captions,
      // but never which one is on screen at the moment the learner is asking
      // about. The scene description rides on the first moment because the
      // model describes the video as a whole, not per frame.
      const visualTimeline = toVisualTimeline(result.onScreenTextSegments, result.sceneContext);

      // Only a meme has its whole meaning riding on the screen text, so only a
      // meme gets its `cultural_context` written from this pass and flagged
      // when the pass comes back empty. Doing that to an ordinary video would
      // overwrite the cultural notes the transcript analysis produced, and put
      // a scary "no on-screen text" error on a clip that never had any.
      const { data: existingRow } = await admin
        .from('discover_videos')
        .select('is_meme')
        .eq('id', videoId)
        .maybeSingle();
      const isMeme = Boolean(existingRow?.is_meme);

      await admin
        .from('discover_videos')
        .update({
          visual_timeline: visualTimeline,
          ...(isMeme
            ? {
                cultural_context: visualCulturalContext
                  ?? 'Meme screen-text extraction found no readable on-screen text. Review the source video manually before publishing.',
                transcription_error: result.onScreenTextSegments.length === 0
                  ? 'Meme screen-text extraction found no readable on-screen text.'
                  : null,
              }
            : {}),
        })
        .eq('id', videoId);

      if (kickoffProcessing) {
        const kickoff = async () => {
          try {
            const response = await fetch(`${supabaseUrl}/functions/v1/process-approved-video`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ videoId }),
            });

            if (!response.ok) {
              const detail = await response.text().catch(() => '');
              await admin.from('discover_videos').update({
                transcription_status: 'failed',
                transcription_error: `Processing kickoff failed (${response.status}): ${detail.slice(0, 500)}`,
              }).eq('id', videoId);
              console.error(`extract-visual-context: processing kickoff failed for ${videoId}`, response.status, detail.slice(0, 300));
            } else {
              await response.text().catch(() => '');
              console.log(`extract-visual-context: processing kicked off for ${videoId}`);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await admin.from('discover_videos').update({
              transcription_status: 'failed',
              transcription_error: `Processing kickoff error: ${message}`,
            }).eq('id', videoId);
            console.error(`extract-visual-context: processing kickoff error for ${videoId}`, message);
          }
        };

        processingQueued = true;
        if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
          EdgeRuntime.waitUntil(kickoff());
        } else {
          kickoff();
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, result, processingQueued }),
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
