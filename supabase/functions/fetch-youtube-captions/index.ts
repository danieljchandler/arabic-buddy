import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const hostname = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (hostname === 'youtube.com') {
      const v = u.searchParams.get('v');
      if (v) return v;
      const pathMatch = u.pathname.match(/^\/(shorts|embed|live)\/([a-zA-Z0-9_-]+)/);
      if (pathMatch) return pathMatch[2];
    }
    return null;
  } catch {
    return null;
  }
}

interface CaptionLine {
  startMs: number;
  endMs: number;
  text: string;
}

async function fetchCaptionTracks(videoId: string): Promise<{ tracks: any[]; playerData: any } | null> {
  // Use Innertube API to get player data including caption tracks
  const clients = [
    {
      clientName: 'WEB',
      clientVersion: '2.20240101.00.00',
    },
    {
      clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
      clientVersion: '2.0',
    },
  ];

  for (const client of clients) {
    try {
      const resp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          context: { client },
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });

      if (!resp.ok) continue;
      const data = await resp.json();

      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks && tracks.length > 0) {
        return { tracks, playerData: data };
      }
    } catch (e) {
      console.error('Innertube caption error:', e);
    }
  }
  return null;
}

async function parseCaptionUrl(captionUrl: string): Promise<CaptionLine[]> {
  // Append fmt=json3 to get structured JSON instead of XML
  const separator = captionUrl.includes('?') ? '&' : '?';
  const jsonUrl = `${captionUrl}${separator}fmt=json3`;

  const resp = await fetch(jsonUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!resp.ok) throw new Error(`Caption fetch failed: ${resp.status}`);

  const data = await resp.json();
  const lines: CaptionLine[] = [];

  for (const event of (data.events || [])) {
    // Skip events without segments or with only whitespace
    if (!event.segs) continue;
    const text = event.segs
      .map((s: any) => (s.utf8 || '').replace(/\n/g, ' '))
      .join('')
      .trim();
    if (!text) continue;

    const startMs = event.tStartMs ?? 0;
    const durationMs = event.dDurationMs ?? 2000;
    lines.push({ startMs, endMs: startMs + durationMs, text });
  }

  return lines;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Auth
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { url } = await req.json();
    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: 'url is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return new Response(JSON.stringify({ error: 'Could not extract YouTube video ID' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Fetching captions for YouTube video: ${videoId}`);

    const result = await fetchCaptionTracks(videoId);
    if (!result) {
      return new Response(JSON.stringify({ error: 'No captions found for this video' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { tracks } = result;
    console.log(`Found ${tracks.length} caption track(s):`, tracks.map((t: any) => t.languageCode).join(', '));

    // Prefer Arabic track, then auto-generated Arabic, then any available track
    const arTrack = tracks.find((t: any) => t.languageCode === 'ar')
      || tracks.find((t: any) => t.languageCode?.startsWith('ar'))
      || tracks[0];

    console.log(`Using caption track: ${arTrack.languageCode} (${arTrack.name?.simpleText || 'unnamed'})`);

    const lines = await parseCaptionUrl(arTrack.baseUrl);

    if (lines.length === 0) {
      return new Response(JSON.stringify({ error: 'Caption track is empty' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rawText = lines.map(l => l.text).join(' ');

    return new Response(
      JSON.stringify({
        success: true,
        videoId,
        languageCode: arTrack.languageCode,
        trackName: arTrack.name?.simpleText || arTrack.languageCode,
        lines,
        rawText,
        availableTracks: tracks.map((t: any) => ({
          languageCode: t.languageCode,
          name: t.name?.simpleText,
        })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('fetch-youtube-captions error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
