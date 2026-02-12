import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;

const SOCIAL_DOMAINS = [
  'tiktok.com', 'vt.tiktok.com', 'vm.tiktok.com',
  'youtube.com', 'youtu.be', 'www.youtube.com', 'm.youtube.com',
  'instagram.com', 'www.instagram.com',
  'twitter.com', 'x.com',
  'soundcloud.com',
];

function isSocialMediaUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return SOCIAL_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

function isTikTokUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return /tiktok\.com$/i.test(hostname);
  } catch {
    return false;
  }
}

function looksLikeMedia(url: string, contentType?: string): boolean {
  if (contentType) {
    if (contentType.startsWith('audio/') || contentType.startsWith('video/')) return true;
    if (contentType === 'application/octet-stream') return true;
  }
  return /\.(mp3|mp4|m4a|wav|ogg|webm|mov|aac|flac)(\?|$)/i.test(url);
}

/**
 * Download bytes from a URL with browser-like headers and return as base64.
 */
async function downloadAsBase64(url: string, referer?: string): Promise<{ base64: string; contentType: string; size: number } | null> {
  try {
    console.log(`Downloading: ${url.substring(0, 120)}...`);
    const resp = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': referer || new URL(url).origin + '/',
      },
    });

    if (!resp.ok) {
      console.error(`Download failed: ${resp.status} ${resp.statusText}`);
      return null;
    }

    const contentType = resp.headers.get('content-type') || 'video/mp4';
    const arrayBuffer = await resp.arrayBuffer();
    const size = arrayBuffer.byteLength;

    if (size > MAX_FILE_SIZE) {
      console.error(`File too large: ${(size / 1024 / 1024).toFixed(1)}MB`);
      return null;
    }

    if (size < 1000) {
      console.error(`File too small (${size} bytes), skipping`);
      return null;
    }

    console.log(`Downloaded ${(size / 1024 / 1024).toFixed(2)}MB, type: ${contentType}`);
    const base64 = base64Encode(new Uint8Array(arrayBuffer));
    return { base64, contentType, size };
  } catch (e) {
    console.error(`Download error:`, e);
    return null;
  }
}

/**
 * TikTok-specific: resolve short URL, get video ID, fetch via TikTok's webapp API.
 */
async function downloadTikTok(url: string): Promise<{ base64: string; contentType: string; size: number; filename: string } | null> {
  console.log('Trying TikTok-specific download...');
  
  try {
    // Step 1: Resolve short URL to full URL and extract video ID
    const resolveResp = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      },
    });
    
    const finalUrl = resolveResp.url;
    console.log(`Resolved to: ${finalUrl}`);
    
    // Extract video ID from URL like /video/1234567890 or /@user/video/1234567890
    const videoIdMatch = finalUrl.match(/\/video\/(\d+)/);
    if (!videoIdMatch) {
      console.error('Could not extract TikTok video ID');
      return null;
    }
    
    const videoId = videoIdMatch[1];
    console.log(`TikTok video ID: ${videoId}`);
    
    // Step 2: Use TikTok's oEmbed API to get info
    const oembedUrl = `https://www.tiktok.com/oembed?url=https://www.tiktok.com/video/${videoId}`;
    const oembedResp = await fetch(oembedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot)' },
    });
    
    if (oembedResp.ok) {
      const oembedData = await oembedResp.json();
      console.log(`oEmbed title: ${oembedData.title?.substring(0, 50)}`);
    }
    
    // Step 3: Fetch the full HTML page to extract video URLs
    const html = await resolveResp.text();
    
    // Extract video URLs from SIGI_STATE or __UNIVERSAL_DATA_FOR_REHYDRATION__
    const videoUrls: string[] = [];
    
    // Pattern 1: playAddr in JSON
    const playAddrPatterns = [
      /"playAddr"\s*:\s*"(https?:[^"]+)"/gi,
      /"downloadAddr"\s*:\s*"(https?:[^"]+)"/gi,
      /"play_addr"\s*:\s*\{[^}]*"url_list"\s*:\s*\["(https?:[^"]+)"/gi,
      /"download_addr"\s*:\s*\{[^}]*"url_list"\s*:\s*\["(https?:[^"]+)"/gi,
    ];
    
    for (const pattern of playAddrPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        if (match[1]) {
          const decoded = match[1]
            .replace(/\\u002F/g, '/')
            .replace(/\\u0026/g, '&')
            .replace(/\\\//g, '/');
          videoUrls.push(decoded);
        }
      }
    }
    
    // Pattern 2: Generic video URLs
    const genericPattern = /https?:[\\\/]+[^"'\s]+v\d+-[^"'\s]+\.(?:mp4|mp3|m4a)(?:[^"'\s]*)/gi;
    let gMatch;
    while ((gMatch = genericPattern.exec(html)) !== null) {
      const decoded = gMatch[0]
        .replace(/\\u002F/g, '/')
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/');
      videoUrls.push(decoded);
    }
    
    // Deduplicate
    const uniqueUrls = [...new Set(videoUrls)];
    console.log(`Found ${uniqueUrls.length} TikTok video URL candidates`);
    
    // Step 4: Try downloading each (use mobile User-Agent + TikTok referer)
    for (const videoUrl of uniqueUrls.slice(0, 5)) {
      const data = await downloadAsBase64(videoUrl, 'https://www.tiktok.com/');
      if (data) {
        return {
          ...data,
          filename: `tiktok_${videoId}.mp4`,
        };
      }
    }
    
    console.log('All TikTok video URLs failed to download');
    return null;
  } catch (e) {
    console.error('TikTok download error:', e);
    return null;
  }
}

/**
 * Try Cobalt v7 API as a generic fallback.
 */
async function downloadViaCobalt(url: string): Promise<{ base64: string; contentType: string; size: number; filename: string } | null> {
  // Try multiple Cobalt instances with both v7 and v10 API formats
  const instances = [
    { url: "https://api.cobalt.tools", version: "v10" },
    { url: "https://downloadapi.stuff.solutions", version: "v7" },
  ];

  for (const instance of instances) {
    console.log(`Trying Cobalt ${instance.version}: ${instance.url} for ${url}`);
    try {
      let cobaltResp: Response;

      if (instance.version === "v10") {
        cobaltResp = await fetch(`${instance.url}/`, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url,
            downloadMode: 'audio',
            audioFormat: 'mp3',
          }),
        });
      } else {
        cobaltResp = await fetch(`${instance.url}/api/json`, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url,
            isAudioOnly: true,
            aFormat: 'mp3',
          }),
        });
      }

      if (!cobaltResp.ok) {
        console.error(`Cobalt ${instance.version} returned ${cobaltResp.status}`);
        continue;
      }

      const cobaltData = await cobaltResp.json();
      console.log(`Cobalt response: ${JSON.stringify(cobaltData).substring(0, 300)}`);

      let downloadUrl: string | null = null;
      let filename = 'audio.mp3';

      if (cobaltData.status === 'tunnel' || cobaltData.status === 'stream' || cobaltData.status === 'success' || cobaltData.status === 'redirect') {
        downloadUrl = cobaltData.url;
      } else if (cobaltData.url && !cobaltData.error) {
        downloadUrl = cobaltData.url;
      } else {
        console.error(`Cobalt error: ${JSON.stringify(cobaltData.error || cobaltData.text || cobaltData)}`);
        continue;
      }

      if (!downloadUrl) continue;

      const data = await downloadAsBase64(downloadUrl);
      if (data) {
        return { ...data, filename: cobaltData.filename || filename };
      }
    } catch (e) {
      console.error(`Cobalt ${instance.version} error:`, e);
    }
  }

  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Authenticate user
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const authToken = authHeader.replace('Bearer ', '');
  const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(authToken);
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    console.log(`Processing URL: ${normalizedUrl}`);

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(normalizedUrl);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid URL format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return new Response(
        JSON.stringify({ error: "Only HTTP/HTTPS URLs are supported" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Strategy 1: Direct media file check
    try {
      const headResp = await fetch(normalizedUrl, { method: 'HEAD', redirect: 'follow' });
      const ct = headResp.headers.get('content-type') || '';
      const finalUrl = headResp.url || normalizedUrl;

      if (looksLikeMedia(finalUrl, ct)) {
        console.log(`Direct media URL detected (${ct}), downloading...`);
        const audioData = await downloadAsBase64(finalUrl);
        if (audioData) {
          return new Response(
            JSON.stringify({
              audioBase64: audioData.base64,
              contentType: audioData.contentType,
              size: audioData.size,
              filename: new URL(finalUrl).pathname.split('/').pop() || 'audio.mp4',
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    } catch (e) {
      console.log("HEAD check failed:", e);
    }

    // Strategy 2: TikTok-specific download
    if (isTikTokUrl(normalizedUrl)) {
      const tiktokResult = await downloadTikTok(normalizedUrl);
      if (tiktokResult) {
        return new Response(
          JSON.stringify({
            audioBase64: tiktokResult.base64,
            contentType: tiktokResult.contentType,
            size: tiktokResult.size,
            filename: tiktokResult.filename,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Strategy 3: Cobalt API for social media
    if (isSocialMediaUrl(normalizedUrl)) {
      const cobaltResult = await downloadViaCobalt(normalizedUrl);
      if (cobaltResult) {
        return new Response(
          JSON.stringify({
            audioBase64: cobaltResult.base64,
            contentType: cobaltResult.contentType,
            size: cobaltResult.size,
            filename: cobaltResult.filename,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: "Could not download the media file. Try uploading the file directly instead." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("download-media error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
