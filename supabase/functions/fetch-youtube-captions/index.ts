import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
      const m = u.pathname.match(/^\/(shorts|embed|live)\/([a-zA-Z0-9_-]+)/);
      if (m) return m[2];
    }
    return null;
  } catch { return null; }
}

interface CaptionLine {
  startMs: number;
  endMs: number;
  text: string;
}

/** Parse YouTube timedtext XML into lines */
function parseTimedtextXml(xml: string): CaptionLine[] {
  const lines: CaptionLine[] = [];
  // Match <text start="X" dur="Y">...</text> pattern
  const re = /<text[^>]+start="([\d.]+)"[^>]*dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const startSec = parseFloat(m[1]);
    const durSec = parseFloat(m[2]);
    const raw = m[3]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, '') // strip inner tags
      .trim();
    if (raw) {
      lines.push({
        startMs: Math.round(startSec * 1000),
        endMs: Math.round((startSec + durSec) * 1000),
        text: raw,
      });
    }
  }
  return lines;
}

/** Parse JSON3 format captions */
function parseJson3(data: any): CaptionLine[] {
  const lines: CaptionLine[] = [];
  const events = data?.events || [];
  for (const ev of events) {
    if (!ev.segs) continue;
    const text = ev.segs.map((s: any) => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
    if (!text || text === ' ') continue;
    lines.push({
      startMs: ev.tStartMs || 0,
      endMs: (ev.tStartMs || 0) + (ev.dDurationMs || 3000),
      text,
    });
  }
  return lines;
}

/** Fetch captions from YouTube timedtext API */
async function fetchCaptions(videoId: string): Promise<{ lines: CaptionLine[]; lang: string } | null> {
  // Try Arabic first, then English fallback
  const langs = [
    { lang: 'ar', kind: '' },
    { lang: 'ar-x-auto', kind: 'asr' },
    { lang: 'en', kind: '' },
    { lang: 'en-US', kind: 'asr' },
  ];

  for (const { lang, kind } of langs) {
    try {
      // Try JSON3 format first
      const kindParam = kind ? `&kind=${kind}` : '';
      const json3Url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}${kindParam}&fmt=json3`;
      console.log(`Trying captions: ${json3Url}`);
      const resp = await fetch(json3Url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (resp.ok) {
        const text = await resp.text();
        if (text && text.trim().startsWith('{')) {
          const data = JSON.parse(text);
          const lines = parseJson3(data);
          if (lines.length > 0) {
            console.log(`Got ${lines.length} caption lines in ${lang} (json3)`);
            return { lines, lang };
          }
        }
      }

      // Try XML format
      const xmlUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}${kindParam}`;
      const xmlResp = await fetch(xmlUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (xmlResp.ok) {
        const xml = await xmlResp.text();
        const lines = parseTimedtextXml(xml);
        if (lines.length > 0) {
          console.log(`Got ${lines.length} caption lines in ${lang} (xml)`);
          return { lines, lang };
        }
      }
    } catch (e) {
      console.error(`Caption fetch error for ${lang}:`, e);
    }
  }

  // Try to get caption track list from the video page
  console.log('Trying to get caption list from video page...');
  try {
    const pageResp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      },
    });
    if (pageResp.ok) {
      const html = await pageResp.text();
      // Extract caption tracks from ytInitialPlayerResponse
      const captionMatch = html.match(/"captionTracks":\s*(\[[\s\S]*?\])/);
      if (captionMatch) {
        const tracks = JSON.parse(captionMatch[1].replace(/\\"/g, '"').replace(/\\/g, ''));
        console.log(`Found ${tracks.length} caption tracks`);
        // Try Arabic tracks first, then any track
        const sorted = [...tracks].sort((a: any, b: any) => {
          const aAr = a.languageCode?.startsWith('ar') ? 0 : 1;
          const bAr = b.languageCode?.startsWith('ar') ? 0 : 1;
          return aAr - bAr;
        });
        for (const track of sorted.slice(0, 3)) {
          const baseUrl = track.baseUrl?.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
          if (!baseUrl) continue;
          console.log(`Trying track: ${track.languageCode} - ${baseUrl.substring(0, 100)}`);
          const trackResp = await fetch(`${baseUrl}&fmt=json3`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
          });
          if (trackResp.ok) {
            const text = await trackResp.text();
            if (text.startsWith('{')) {
              const data = JSON.parse(text);
              const lines = parseJson3(data);
              if (lines.length > 0) {
                return { lines, lang: track.languageCode };
              }
            }
            // Try XML
            const xmlResp2 = await fetch(baseUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (xmlResp2.ok) {
              const xml = await xmlResp2.text();
              const lines = parseTimedtextXml(xml);
              if (lines.length > 0) {
                return { lines, lang: track.languageCode };
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('Page scrape error:', e);
  }

  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url, videoId: providedId } = await req.json();

    const videoId = providedId || (url ? extractVideoId(url) : null);
    if (!videoId) {
      return new Response(
        JSON.stringify({ error: 'Could not extract YouTube video ID' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Fetching captions for video: ${videoId}`);
    const result = await fetchCaptions(videoId);

    if (!result || result.lines.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No captions found for this video. Try uploading the audio file directly.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Merge adjacent lines into sentence-like chunks (group by ~3 second windows)
    const merged: CaptionLine[] = [];
    let current: CaptionLine | null = null;
    for (const line of result.lines) {
      if (!current) {
        current = { ...line };
      } else if (line.startMs - current.endMs < 800 && (current.endMs - current.startMs) < 5000) {
        // Merge nearby lines
        current.text += ' ' + line.text;
        current.endMs = line.endMs;
      } else {
        merged.push(current);
        current = { ...line };
      }
    }
    if (current) merged.push(current);

    return new Response(
      JSON.stringify({
        videoId,
        lang: result.lang,
        lines: merged,
        rawText: merged.map(l => l.text).join('\n'),
        count: merged.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('fetch-youtube-captions error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
