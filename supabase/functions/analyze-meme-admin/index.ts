// Admin-grade meme analyzer.
// Strict anti-hallucination contract:
//   - On-screen text comes ONLY from OCR of provided frames.
//   - Audio lines come ONLY from provided ASR transcript (or empty).
//   - Vocabulary entries must reference text present in OCR or ASR.
// Skips audio entirely when the caller signals no speech / music-only.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const generateId = () => crypto.randomUUID().slice(0, 8);

function extractJson(text: string): string {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  return a !== -1 && b > a ? cleaned.slice(a, b + 1) : cleaned;
}

function safeParse<T>(t: string): T | null {
  try { return JSON.parse(extractJson(t)) as T; } catch { return null; }
}

function tokens(arabic: string, glosses: Record<string, string> = {}) {
  return arabic.split(/\s+/).filter(Boolean).map((surface, idx) => ({
    id: `tok-${generateId()}-${idx}`,
    surface,
    gloss: glosses[surface],
  }));
}

async function callGemini(
  systemPrompt: string,
  userContent: unknown,
  apiKey: string,
  maxTokens = 6000,
): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      console.error('AI gateway error', resp.status, txt.slice(0, 400));
      if (resp.status === 402) throw new Error('AI credits exhausted');
      if (resp.status === 429) throw new Error('Rate limit exceeded');
      throw new Error(`AI service error (${resp.status})`);
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty AI response');
    return content;
  } finally {
    clearTimeout(t);
  }
}

const DIALECT_NOTES: Record<string, string> = {
  Gulf: 'Gulf (Khaleeji) Arabic. Avoid MSA. Avoid Egyptian/Levantine forms.',
  Egyptian: 'Egyptian Arabic (Masri). Avoid MSA. Avoid Khaleeji/Levantine forms.',
  Yemeni: 'Yemeni Arabic. Avoid MSA. Avoid Khaleeji/Egyptian forms.',
};

const OCR_PROMPT = (dialect: string) => `You are an OCR + cultural analysis engine for an Arabic meme.
Dialect context: ${DIALECT_NOTES[dialect] ?? DIALECT_NOTES.Gulf}

You are given one or more image frames. For EACH frame, extract EVERY Arabic text element you can read on screen — captions, watermarks, overlaid text, signs, subtitles. Preserve dialect spelling exactly as written. Do NOT translate to MSA. Do NOT invent text that isn't visibly present.

Return ONLY this JSON shape, no prose:
{
  "frames": [
    {
      "frameIndex": 0,
      "timestampSeconds": 0,
      "lines": [ { "arabic": "...", "translation": "..." } ]
    }
  ],
  "memeExplanation": {
    "casual": "2-3 fun sentences explaining what's funny",
    "cultural": "3-5 sentences on cultural / linguistic context"
  },
  "vocabulary": [ { "arabic": "...", "english": "...", "root": "optional" } ],
  "grammarPoints": [ { "title": "...", "explanation": "...", "examples": ["..."] } ],
  "glosses": { "arabicWord": "english" },
  "thumbnailFrameIndex": 0
}

Hard rules:
- Every "arabic" string in lines/vocabulary MUST be visibly present in at least one frame. Never invent.
- If a frame has no Arabic text, return an empty "lines" array for that frame.
- If the meme has no Arabic on screen at all, set vocabulary and grammarPoints to [] and explain that in memeExplanation.
- thumbnailFrameIndex: pick the frame with the most/clearest text (the "money frame"). Default to 0 if unclear.`;

const AUDIO_PROMPT = (dialect: string) => `You are processing an ASR transcript from an Arabic meme video.
Dialect context: ${DIALECT_NOTES[dialect] ?? DIALECT_NOTES.Gulf}

Return ONLY this JSON, no prose:
{
  "lines": [ { "arabic": "...", "translation": "...", "startMs": 0, "endMs": 0 } ],
  "vocabulary": [ { "arabic": "...", "english": "...", "root": "optional" } ],
  "grammarPoints": [ { "title": "...", "explanation": "...", "examples": ["..."] } ],
  "glosses": { "arabicWord": "english" }
}

Hard rules:
- Every "arabic" string MUST be a substring (or trivially normalized form) of the provided transcript. Do NOT invent words.
- If the transcript is empty or only contains music/noise tags, return all arrays empty.
- Split into 3-12 word segments aligned with the transcript ordering.`;

interface FrameInput { dataUri: string; timestampSeconds: number }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // --- Auth: must be admin ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supa.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: roleRow } = await supa.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'admin').maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: 'Admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const {
      frames = [],
      audioTranscript = '',
      audioLines = [], // optional pre-segmented ASR
      hasSpeech = false,
      hasMusic = false,
      audioSkippedReason = null,
      dialect = 'Gulf',
    } = body as {
      frames: FrameInput[];
      audioTranscript?: string;
      audioLines?: Array<{ arabic: string; startMs?: number; endMs?: number }>;
      hasSpeech?: boolean;
      hasMusic?: boolean;
      audioSkippedReason?: string | null;
      dialect?: string;
    };

    if (!Array.isArray(frames) || frames.length === 0) {
      return new Response(JSON.stringify({ error: 'frames[] required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- 1. Vision OCR pass over all frames ---
    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    frames.forEach((f, idx) => {
      const url = f.dataUri.startsWith('data:') ? f.dataUri : `data:image/jpeg;base64,${f.dataUri}`;
      userContent.push({ type: 'image_url', image_url: { url } });
      userContent.push({ type: 'text', text: `Frame ${idx} @ ${f.timestampSeconds}s` });
    });
    userContent.push({
      type: 'text',
      text: `Total frames: ${frames.length}. Read every Arabic word visible. Do NOT invent text. Return JSON exactly per schema.`,
    });

    const visionRaw = await callGemini(OCR_PROMPT(dialect), userContent, LOVABLE_API_KEY, 6000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vision = safeParse<any>(visionRaw);
    if (!vision) throw new Error('OCR JSON parse failed');

    // --- 2. Build canonical OCR text corpus for validation ---
    const ocrLinesAll: Array<{ arabic: string; translation: string; frameTimestamp: number }> = [];
    if (Array.isArray(vision.frames)) {
      for (const fr of vision.frames) {
        const ts = Number(fr.timestampSeconds ?? 0);
        for (const ln of fr.lines ?? []) {
          const ar = String(ln.arabic ?? '').trim();
          if (!ar) continue;
          ocrLinesAll.push({
            arabic: ar,
            translation: String(ln.translation ?? ''),
            frameTimestamp: ts,
          });
        }
      }
    }
    const ocrCorpus = ocrLinesAll.map((l) => l.arabic).join(' ');

    // --- 3. Audio pass (only when requested + transcript present) ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let audioResult: any = null;
    const transcript = String(audioTranscript ?? '').trim();
    if (hasSpeech && transcript.length > 4) {
      try {
        const audioRaw = await callGemini(AUDIO_PROMPT(dialect), transcript, LOVABLE_API_KEY, 4000);
        audioResult = safeParse(audioRaw);
      } catch (e) {
        console.warn('Audio analysis failed:', e instanceof Error ? e.message : e);
      }
    }
    const audioCorpus = transcript;

    // --- 4. Validate vocabulary against corpora (drop hallucinations) ---
    const fullCorpus = (ocrCorpus + ' ' + audioCorpus).replace(/\s+/g, ' ');
    const validateVocab = (v: { arabic: string }) => {
      const ar = String(v.arabic ?? '').trim();
      return !!ar && fullCorpus.includes(ar);
    };

    const onScreenVocab = (vision.vocabulary ?? []).filter(validateVocab);
    const onScreenGramamr = (vision.grammarPoints ?? []).filter((g: { title?: string }) => g?.title);

    // --- 5. Build response payload ---
    const onScreenGlosses = vision.glosses ?? {};
    const onScreenLines = ocrLinesAll.map((l, idx) => ({
      id: `os-${generateId()}-${idx}`,
      arabic: l.arabic,
      translation: l.translation,
      frameTimestamp: l.frameTimestamp,
      tokens: tokens(l.arabic, onScreenGlosses),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let audioPayload: any = null;
    if (audioResult) {
      const audioGlosses = audioResult.glosses ?? {};
      const validAudioLines = (audioResult.lines ?? []).filter((l: { arabic?: string }) => {
        const ar = String(l.arabic ?? '').trim();
        return ar && audioCorpus.includes(ar.split(' ')[0]);
      });
      audioPayload = {
        lines: validAudioLines.map((l: { arabic: string; translation?: string; startMs?: number; endMs?: number }, idx: number) => ({
          id: `au-${generateId()}-${idx}`,
          arabic: String(l.arabic),
          translation: String(l.translation ?? ''),
          startMs: typeof l.startMs === 'number' ? l.startMs : undefined,
          endMs: typeof l.endMs === 'number' ? l.endMs : undefined,
          tokens: tokens(String(l.arabic), audioGlosses),
        })),
        vocabulary: (audioResult.vocabulary ?? []).filter(validateVocab),
        grammarPoints: (audioResult.grammarPoints ?? []).filter((g: { title?: string }) => g?.title),
      };
    } else if (audioLines.length && hasSpeech) {
      // Fallback: caller provided pre-segmented ASR lines
      audioPayload = {
        lines: audioLines.map((l, idx) => ({
          id: `au-${generateId()}-${idx}`,
          arabic: String(l.arabic),
          translation: '',
          startMs: l.startMs,
          endMs: l.endMs,
          tokens: tokens(String(l.arabic)),
        })),
        vocabulary: [],
        grammarPoints: [],
      };
    }

    const result = {
      memeExplanation: vision.memeExplanation ?? { casual: '', cultural: '' },
      onScreenText: {
        lines: onScreenLines,
        vocabulary: onScreenVocab,
        grammarPoints: onScreenGramamr,
      },
      audioText: audioPayload,
      thumbnailFrameIndex: typeof vision.thumbnailFrameIndex === 'number' ? vision.thumbnailFrameIndex : 0,
      hasSpeech,
      hasMusic,
      audioSkippedReason,
      // Auto title from biggest OCR line, fallback to translation
      autoTitle: ocrLinesAll[0]?.translation?.slice(0, 80) || vision.memeExplanation?.casual?.slice(0, 80) || 'Meme',
      autoTitleArabic: ocrLinesAll[0]?.arabic?.slice(0, 80) || '',
    };

    console.log('analyze-meme-admin OK', {
      frames: frames.length,
      ocrLines: onScreenLines.length,
      audioLines: audioPayload?.lines?.length ?? 0,
      droppedVocab: (vision.vocabulary?.length ?? 0) - onScreenVocab.length,
    });

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('analyze-meme-admin error:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
