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

function parseTimedtextXml(xml: string): CaptionLine[] {
  const lines: CaptionLine[] = [];
  const re = /<text[^>]+start="([\d.]+)"[^>]*dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const startSec = parseFloat(m[1]);
    const durSec = parseFloat(m[2]);
    const raw = m[3]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, '').trim();
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

function tryParseJson3(text: string): CaptionLine[] {
  if (!text || text.trim().length < 5) return [];
  // Try direct parse
  try {
    return parseJson3(JSON.parse(text.trim()));
  } catch { /* continue */ }
  // Try to find JSON object in text
  const match = text.match(/(\{"wireMagic"[\s\S]*\}|\{"events"[\s\S]*\})/);
  if (match) {
    try { return parseJson3(JSON.parse(match[1])); } catch { /* continue */ }
  }
  return [];
}

function fixUrl(url: string): string {
  return url
    .replace(/\\u0026/g, '&')
    .replace(/(?<![\\])u0026/g, '&')
    .replace(/\\\//g, '/')
    .trim();
}

async function jinaFetch(url: string, jinaKey: string, format = 'text'): Promise<string | null> {
  try {
    const resp = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        'Authorization': `Bearer ${jinaKey}`,
        'X-Return-Format': format,
        'X-No-Cache': 'true',
      },
    });
    if (resp.ok) return await resp.text();
    console.log(`Jina ${format} failed: ${resp.status}`);
  } catch (e) {
    console.error('Jina error:', e);
  }
  return null;
}

async function fetchCaptionContent(captionUrl: string, lang: string, jinaKey?: string): Promise<CaptionLine[]> {
  const clean = fixUrl(captionUrl);

  // Try json3 direct
  for (const fmt of ['json3', 'srv3', '']) {
    const url = fmt ? `${clean.replace(/&fmt=[^&]*/g, '')}&fmt=${fmt}` : clean.replace(/&fmt=[^&]*/g, '');
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cookie': 'CONSENT=YES+cb',
        },
      });
      if (resp.ok) {
        const text = await resp.text();
        if (text && text.trim().length > 5) {
          const lines = fmt !== '' ? tryParseJson3(text) : parseTimedtextXml(text);
          if (lines.length > 0) {
            console.log(`Direct ${fmt || 'xml'} worked for ${lang}: ${lines.length} lines`);
            return lines;
          }
          // Try xml parse on json3/srv3 too
          const xmlLines = parseTimedtextXml(text);
          if (xmlLines.length > 0) return xmlLines;
        }
      }
    } catch (e) { /* continue */ }
  }

  // Try via Jina as proxy for the caption content
  if (jinaKey) {
    const json3Url = `${clean.replace(/&fmt=[^&]*/g, '')}&fmt=json3`;
    const content = await jinaFetch(json3Url, jinaKey, 'text');
    if (content) {
      console.log(`Jina caption content (${lang}): ${content.substring(0, 200)}`);
      const lines = tryParseJson3(content);
      if (lines.length > 0) {
        console.log(`Jina proxy worked for ${lang}: ${lines.length} lines`);
        return lines;
      }
      // Try XML
      const xmlLines = parseTimedtextXml(content);
      if (xmlLines.length > 0) return xmlLines;
    }
  }

  return [];
}

function extractTracksFromHtml(html: string): any[] {
  // Try multiple patterns
  const patterns = [
    /"captionTracks":\s*(\[[\s\S]*?\])\s*,\s*"audioTracks"/,
    /"captionTracks":\s*(\[[\s\S]*?\]),/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        const tracks = JSON.parse(match[1]);
        if (Array.isArray(tracks) && tracks.length > 0) return tracks;
      } catch { /* continue */ }
    }
  }

  // Try parsing full ytInitialPlayerResponse
  const playerPatterns = [
    /ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var |const |let |window\[)/s,
    /ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?"captionTracks"[\s\S]+?\});\s*(?:var|const|let|;)/,
  ];
  for (const pattern of playerPatterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        if (tracks.length > 0) return tracks;
      } catch { /* continue */ }
    }
  }

  return [];
}

async function fetchCaptions(videoId: string, jinaKey?: string): Promise<{ lines: CaptionLine[]; lang: string } | null> {
  // Strategy 1: Static timedtext API - works for some videos without tokens
  const directLangs = [
    { lang: 'ar', kind: '' },
    { lang: 'ar-x-auto', kind: 'asr' },
  ];

  for (const { lang, kind } of directLangs) {
    const kindParam = kind ? `&kind=${kind}` : '';
    const captionUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}${kindParam}&fmt=json3`;
    try {
      const resp = await fetch(captionUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cookie': 'CONSENT=YES+cb; YSC=abc123',
        },
      });
      if (resp.ok) {
        const text = await resp.text();
        const lines = tryParseJson3(text);
        if (lines.length > 0) {
          console.log(`Static timedtext ${lang}: ${lines.length} lines`);
          return { lines, lang };
        }
      }
    } catch (e) { /* continue */ }
  }

  // Strategy 2: Use Jina to proxy the static timedtext URLs directly
  if (jinaKey) {
    for (const { lang, kind } of directLangs) {
      const kindParam = kind ? `&kind=${kind}` : '';
      const captionUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}${kindParam}&fmt=json3`;
      const content = await jinaFetch(captionUrl, jinaKey, 'text');
      if (content) {
        console.log(`Jina static timedtext (${lang}): ${content.substring(0, 200)}`);
        const lines = tryParseJson3(content);
        if (lines.length > 0) {
          console.log(`Jina static timedtext worked (${lang}): ${lines.length} lines`);
          return { lines, lang };
        }
        const xmlLines = parseTimedtextXml(content);
        if (xmlLines.length > 0) return { lines: xmlLines, lang };
      }
    }
  }

  // Strategy 3: Get token-based track URLs from watch page, then fetch immediately
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US`;
  let watchHtml: string | null = null;

  // Try direct watch page
  try {
    const resp = await fetch(watchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        'Cookie': 'CONSENT=YES+cb; YSC=DwKYllHNwuw; VISITOR_INFO1_LIVE=abc',
      },
    });
    if (resp.ok) {
      watchHtml = await resp.text();
      console.log(`Direct watch page: ${watchHtml.length} chars, hasCaptionTracks: ${watchHtml.includes('captionTracks')}`);
    }
  } catch (e) {
    console.error('Watch page error:', e);
  }

  // Try Jina for watch page
  if ((!watchHtml || !watchHtml.includes('captionTracks')) && jinaKey) {
    const content = await jinaFetch(watchUrl, jinaKey, 'html');
    if (content && content.includes('captionTracks')) {
      watchHtml = content;
      console.log(`Jina watch page: ${watchHtml.length} chars with captionTracks`);
    }
  }

  if (watchHtml && watchHtml.includes('captionTracks')) {
    const tracks = extractTracksFromHtml(watchHtml);
    console.log(`Found ${tracks.length} tracks from watch page`);

    if (tracks.length > 0) {
      // Sort: Arabic first
      const sorted = [...tracks].sort((a: any, b: any) =>
        (a.languageCode?.startsWith('ar') ? 0 : 1) - (b.languageCode?.startsWith('ar') ? 0 : 1)
      );

      for (const track of sorted.slice(0, 5)) {
        if (!track.baseUrl) continue;
        const lang = track.languageCode || 'unknown';
        console.log(`Trying track: ${lang}`);
        const lines = await fetchCaptionContent(track.baseUrl, lang, jinaKey);
        if (lines.length > 0) return { lines, lang };
      }
    }
  }

  // Strategy 4: Android Innertube (sometimes bypasses auth)
  try {
    const body = JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '18.11.34',
          androidSdkVersion: 30,
          hl: 'en',
          gl: 'US',
        },
      },
    });
    const resp = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/18.11.34 (Linux; U; Android 11) gzip',
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': '18.11.34',
      },
      body,
    });
    console.log(`Android innertube: ${resp.status}`);
    if (resp.ok) {
      const data = await resp.json();
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      console.log(`Android innertube tracks: ${tracks.length}`);
      if (tracks.length > 0) {
        const sorted = [...tracks].sort((a: any, b: any) =>
          (a.languageCode?.startsWith('ar') ? 0 : 1) - (b.languageCode?.startsWith('ar') ? 0 : 1)
        );
        for (const track of sorted.slice(0, 5)) {
          if (!track.baseUrl) continue;
          const lang = track.languageCode || 'unknown';
          const lines = await fetchCaptionContent(track.baseUrl, lang, jinaKey);
          if (lines.length > 0) return { lines, lang };
        }
      }
    }
  } catch (e) {
    console.error('Android innertube error:', e);
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

    const jinaKey = Deno.env.get('JINA_API_KEY');
    console.log(`Fetching captions for: ${videoId}, Jina: ${!!jinaKey}`);

    const result = await fetchCaptions(videoId, jinaKey);

    if (!result || result.lines.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No captions found for this video. Try uploading the audio file directly.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Merge adjacent lines into sentence chunks
    const merged: CaptionLine[] = [];
    let current: CaptionLine | null = null;
    for (const line of result.lines) {
      if (!current) {
        current = { ...line };
      } else if (line.startMs - current.endMs < 800 && (current.endMs - current.startMs) < 6000) {
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
