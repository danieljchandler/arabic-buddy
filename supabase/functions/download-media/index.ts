import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { assertPublicHttpUrl, BlockedUrlError, safeFetch } from "../_shared/safeFetch.ts";

function encodeBase64(data: Uint8Array): string {
  const binString = Array.from(data, (b) => String.fromCharCode(b)).join('');
  return btoa(binString);
}


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

function isYouTubeUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').replace(/^m\./, '');
    return ['youtube.com', 'youtu.be'].includes(hostname);
  } catch {
    return false;
  }
}

function extractYouTubeVideoId(url: string): string | null {
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

// ─── Cobalt API ─────────────────────────────────────────────────────────────
// Cobalt is the most reliable approach for YouTube audio.
// Uses youtubeHLS to bypass PO token restrictions.
async function downloadViaCobalt(url: string, wantVideo = false): Promise<{ base64: string; contentType: string; size: number; filename: string } | null> {
  const cobaltApiKey = Deno.env.get('COBALT_API_KEY');

  // Community Cobalt instances — try instances that don't require auth first,
  // then the official one (which does require auth) if we have a key.
  const instances: { url: string; needsKey: boolean }[] = [
    { url: "https://co.imput.net", needsKey: false },
    { url: "https://cobalt.canine.tools", needsKey: false },
    { url: "https://api.cobalt.tools", needsKey: true },
  ];

  for (const instance of instances) {
    if (instance.needsKey && !cobaltApiKey) {
      console.log(`Skipping ${instance.url} (needs COBALT_API_KEY)`);
      continue;
    }

    console.log(`Trying Cobalt: ${instance.url}`);
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; arabic-buddy/1.0)',
      };
      if (instance.needsKey && cobaltApiKey) {
        headers['Authorization'] = `Api-Key ${cobaltApiKey}`;
      }

      const cobaltResp = await fetch(`${instance.url}/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url,
          // 'auto' returns the muxed video; the on-screen-text re-read needs
          // the pictures, and every other caller wants the audio track alone.
          downloadMode: wantVideo ? 'auto' : 'audio',
          ...(wantVideo
            ? { videoQuality: '480' }
            : { audioFormat: 'mp3', audioBitrate: '128' }),
          filenameStyle: 'basic',
          youtubeHLS: true,  // HLS avoids PO token requirement
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!cobaltResp.ok) {
        const errText = await cobaltResp.text().catch(() => '');
        console.error(`Cobalt ${instance.url} returned ${cobaltResp.status}: ${errText.substring(0, 200)}`);
        continue;
      }

      const cobaltData = await cobaltResp.json();
      console.log(`Cobalt response: ${JSON.stringify(cobaltData).substring(0, 300)}`);

      let downloadUrl: string | null = null;
      let filename = 'audio.mp3';

      if (cobaltData.status === 'tunnel' || cobaltData.status === 'stream' ||
          cobaltData.status === 'success' || cobaltData.status === 'redirect') {
        downloadUrl = cobaltData.url;
        filename = cobaltData.filename || filename;
      } else if (cobaltData.status === 'local-processing') {
        // local-processing returns tunnel URLs to download from
        const tunnelUrls = cobaltData.tunnel || [];
        if (tunnelUrls.length > 0) {
          downloadUrl = tunnelUrls[0];
          filename = cobaltData.output?.filename || filename;
        }
      } else if (cobaltData.url && !cobaltData.error) {
        downloadUrl = cobaltData.url;
        filename = cobaltData.filename || filename;
      } else {
        const errInfo = cobaltData.error?.code || cobaltData.error || cobaltData.text || 'unknown';
        console.error(`Cobalt error: ${JSON.stringify(errInfo)}`);
        continue;
      }

      if (!downloadUrl) continue;

      const data = await downloadAsBase64(downloadUrl);
      if (data) {
        return { ...data, filename };
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        console.error(`Cobalt ${instance.url} timed out`);
      } else {
        console.error(`Cobalt ${instance.url} error:`, e);
      }
    }
  }

  return null;
}

// ─── RapidAPI services ──────────────────────────────────────────────────────
async function downloadYouTubeViaRapidApi(url: string): Promise<{ base64: string; contentType: string; size: number; filename: string } | null> {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) return null;

  const apiKey = Deno.env.get('RAPIDAPI_KEY');
  if (!apiKey) {
    console.log('RAPIDAPI_KEY not set, skipping RapidAPI strategy');
    return null;
  }

  // Try multiple RapidAPI endpoints as fallbacks
  const strategies = [
    () => tryRapidApiMp36(videoId, apiKey),
    () => tryRapidApiMp3Download3(videoId, apiKey),
    () => tryRapidApiMp3_2025(videoId, apiKey),
    () => tryRapidApiYtToMp3(videoId, apiKey),
  ];

  for (const strategy of strategies) {
    const result = await strategy();
    if (result) return result;
  }

  return null;
}

async function tryRapidApiMp36(videoId: string, apiKey: string): Promise<{ base64: string; contentType: string; size: number; filename: string } | null> {
  console.log(`Trying RapidAPI (youtube-mp36) for video: ${videoId}`);
  try {
    let link: string | null = null;

    for (let attempt = 0; attempt < 4; attempt++) {
      const resp = await fetch(`https://youtube-mp36.p.rapidapi.com/dl?id=${videoId}`, {
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'youtube-mp36.p.rapidapi.com',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        console.error(`RapidAPI mp36 returned ${resp.status}`);
        return null;
      }

      const data = await resp.json();
      console.log(`RapidAPI mp36 attempt ${attempt + 1}: status=${data.status}`);

      if (data.status === 'ok' && data.link) {
        link = data.link;
        break;
      } else if (data.status === 'processing') {
        await new Promise((r) => setTimeout(r, 3000));
      } else {
        console.error('RapidAPI mp36 error:', data.msg || data.status);
        return null;
      }
    }

    if (!link) return null;

    const audioData = await downloadAsBase64(link);
    if (audioData) return { ...audioData, filename: `youtube_${videoId}.mp3` };
    return null;
  } catch (e) {
    console.error('RapidAPI mp36 error:', e);
    return null;
  }
}

async function tryRapidApiMp3Download3(videoId: string, apiKey: string): Promise<{ base64: string; contentType: string; size: number; filename: string } | null> {
  console.log(`Trying RapidAPI (youtube-mp3-download3) for video: ${videoId}`);
  try {
    const resp = await fetch(`https://youtube-mp3-download3.p.rapidapi.com/download-mp3?yt=https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'youtube-mp3-download3.p.rapidapi.com',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      console.error(`RapidAPI mp3-download3 returned ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    console.log(`RapidAPI mp3-download3 response keys: ${Object.keys(data).join(', ')}`);

    const downloadUrl = data.mp3_url || data.url || data.link || data.download_url;
    if (!downloadUrl) {
      console.error('RapidAPI mp3-download3: no download URL in response');
      return null;
    }

    const audioData = await downloadAsBase64(downloadUrl);
    if (audioData) return { ...audioData, filename: `youtube_${videoId}.mp3` };
    return null;
  } catch (e) {
    console.error('RapidAPI mp3-download3 error:', e);
    return null;
  }
}

async function tryRapidApiMp3_2025(videoId: string, apiKey: string): Promise<{ base64: string; contentType: string; size: number; filename: string } | null> {
  console.log(`Trying RapidAPI (youtube-mp3-2025) for video: ${videoId}`);
  try {
    const resp = await fetch('https://youtube-mp3-2025.p.rapidapi.com/v1/social/youtube/audio', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'youtube-mp3-2025.p.rapidapi.com',
      },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        quality: '128kbps',
        ext: 'mp3',
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      console.error(`RapidAPI mp3-2025 returned ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    console.log(`RapidAPI mp3-2025 response keys: ${Object.keys(data).join(', ')}`);

    const downloadUrl = data.url || data.link || data.download_url || data.audioUrl;
    if (!downloadUrl) {
      console.error('RapidAPI mp3-2025: no download URL in response');
      return null;
    }

    const audioData = await downloadAsBase64(downloadUrl);
    if (audioData) return { ...audioData, filename: `youtube_${videoId}.mp3` };
    return null;
  } catch (e) {
    console.error('RapidAPI mp3-2025 error:', e);
    return null;
  }
}

async function tryRapidApiYtToMp3(videoId: string, apiKey: string): Promise<{ base64: string; contentType: string; size: number; filename: string } | null> {
  console.log(`Trying RapidAPI (youtube-to-mp3-download) for video: ${videoId}`);
  try {
    const resp = await fetch(`https://youtube-to-mp3-download.p.rapidapi.com/mp3?videoId=${videoId}`, {
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'youtube-to-mp3-download.p.rapidapi.com',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      console.error(`RapidAPI yt-to-mp3 returned ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    console.log(`RapidAPI yt-to-mp3 response keys: ${Object.keys(data).join(', ')}`);

    const downloadUrl = data.url || data.link || data.download_url || data.mp3;
    if (!downloadUrl) {
      console.error('RapidAPI yt-to-mp3: no download URL');
      return null;
    }

    const audioData = await downloadAsBase64(downloadUrl);
    if (audioData) return { ...audioData, filename: `youtube_${videoId}.mp3` };
    return null;
  } catch (e) {
    console.error('RapidAPI yt-to-mp3 error:', e);
    return null;
  }
}

// ─── Innertube API ──────────────────────────────────────────────────────────
// YouTube's internal API. Clients updated to current versions.
// TV_EMBEDDED is the least restricted client that doesn't need PO tokens.
async function downloadYouTubeViaInnertube(url: string): Promise<{ base64: string; contentType: string; size: number; filename: string } | null> {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    console.error('Could not extract YouTube video ID from:', url);
    return null;
  }

  console.log(`Trying Innertube API for YouTube video: ${videoId}`);

  // TV_EMBEDDED is the least restricted — doesn't need PO tokens and works
  // for most videos. ANDROID_TESTSUITE is another fallback.
  const clients = [
    {
      name: 'TVHTML5_SIMPLY_EMBEDDED',
      endpoint: 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      } as Record<string, string>,
      body: {
        context: {
          client: {
            clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
            clientVersion: '2.0',
            hl: 'en',
            gl: 'US',
          },
          thirdParty: {
            embedUrl: 'https://www.google.com',
          },
        },
      },
    },
    {
      name: 'ANDROID_MUSIC',
      endpoint: 'https://music.youtube.com/youtubei/v1/player?prettyPrint=false',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 14; en_US) gzip',
        'X-YouTube-Client-Name': '21',
        'X-YouTube-Client-Version': '7.27.52',
      } as Record<string, string>,
      body: {
        context: {
          client: {
            clientName: 'ANDROID_MUSIC',
            clientVersion: '7.27.52',
            androidSdkVersion: 34,
            hl: 'en',
            gl: 'US',
          },
        },
      },
    },
    {
      name: 'ANDROID',
      endpoint: 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/19.44.38 (Linux; U; Android 14) gzip',
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': '19.44.38',
      } as Record<string, string>,
      body: {
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.44.38',
            androidSdkVersion: 34,
            hl: 'en',
            gl: 'US',
          },
        },
      },
    },
    {
      name: 'IOS',
      endpoint: 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1 like Mac OS X)',
        'X-YouTube-Client-Name': '5',
        'X-YouTube-Client-Version': '19.45.4',
      } as Record<string, string>,
      body: {
        context: {
          client: {
            clientName: 'IOS',
            clientVersion: '19.45.4',
            deviceMake: 'Apple',
            deviceModel: 'iPhone16,2',
            osName: 'iOS',
            osVersion: '18.1.0',
            hl: 'en',
            gl: 'US',
          },
        },
      },
    },
  ];

  for (const client of clients) {
    try {
      console.log(`Trying YouTube client: ${client.name}`);
      const playerResp = await fetch(client.endpoint, {
        method: 'POST',
        headers: client.headers,
        body: JSON.stringify({
          videoId,
          ...client.body,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!playerResp.ok) {
        console.error(`Innertube ${client.name} returned ${playerResp.status}`);
        continue;
      }

      const playerData = await playerResp.json();

      if (playerData.playabilityStatus?.status !== 'OK') {
        console.error(`${client.name}: ${playerData.playabilityStatus?.status} - ${playerData.playabilityStatus?.reason || 'unknown'}`);
        continue;
      }

      const formats = [
        ...(playerData.streamingData?.adaptiveFormats || []),
        ...(playerData.streamingData?.formats || []),
      ];

      // Check for HLS manifest as fallback (no PO token needed)
      const hlsUrl = playerData.streamingData?.hlsManifestUrl;

      // Get formats with direct URLs
      const audioFormats = formats
        .filter((f: any) => f.mimeType?.startsWith('audio/') && f.url)
        .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

      // Also try formats with signatureCipher (need to decode)
      const cipherAudioFormats = formats
        .filter((f: any) => f.mimeType?.startsWith('audio/') && !f.url && f.signatureCipher)
        .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

      const videoFormats = formats
        .filter((f: any) => f.url && !f.mimeType?.startsWith('audio/'))
        .sort((a: any, b: any) => (a.bitrate || 0) - (b.bitrate || 0));

      const tryFormats = [...audioFormats.slice(0, 3), ...videoFormats.slice(0, 2)];

      // Try direct URL formats first
      for (const format of tryFormats) {
        const contentLength = parseInt(format.contentLength || '0');
        if (contentLength > MAX_FILE_SIZE) {
          console.log(`Skipping format (${(contentLength / 1024 / 1024).toFixed(1)}MB too large)`);
          continue;
        }

        console.log(`Downloading: ${format.mimeType}, bitrate: ${format.bitrate}`);
        const data = await downloadAsBase64(format.url, 'https://www.youtube.com/');
        if (data) {
          const isAudio = format.mimeType?.startsWith('audio/');
          const ext = format.mimeType?.includes('webm') ? 'webm' : isAudio ? 'm4a' : 'mp4';
          return { ...data, filename: `youtube_${videoId}.${ext}` };
        }
      }

      // Try signatureCipher formats (basic decode)
      for (const format of cipherAudioFormats.slice(0, 2)) {
        try {
          const params = new URLSearchParams(format.signatureCipher);
          const cipherUrl = params.get('url');
          if (!cipherUrl) continue;

          // Try the URL directly — some ciphered URLs work without decoding
          // (YouTube sometimes includes the signature in the URL itself)
          const contentLength = parseInt(format.contentLength || '0');
          if (contentLength > MAX_FILE_SIZE) continue;

          console.log(`Trying cipher format: ${format.mimeType}, bitrate: ${format.bitrate}`);
          const data = await downloadAsBase64(cipherUrl, 'https://www.youtube.com/');
          if (data) {
            const ext = format.mimeType?.includes('webm') ? 'webm' : 'm4a';
            return { ...data, filename: `youtube_${videoId}.${ext}` };
          }
        } catch {
          // Skip cipher formats we can't handle
        }
      }

      // Try HLS manifest as last resort
      if (hlsUrl) {
        console.log(`Trying HLS manifest for ${client.name}`);
        try {
          const hlsResp = await fetch(hlsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(10000),
          });
          if (hlsResp.ok) {
            const manifest = await hlsResp.text();
            // Find audio-only stream URLs in the manifest
            const audioLines = manifest.split('\n')
              .filter((line: string) => line.includes('TYPE=AUDIO') || (line.startsWith('http') && !line.includes('video')));

            // Find the best audio playlist URL
            let audioPlaylistUrl: string | null = null;
            const lines = manifest.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes('TYPE=AUDIO') && lines[i].includes('URI="')) {
                const uriMatch = lines[i].match(/URI="([^"]+)"/);
                if (uriMatch) {
                  audioPlaylistUrl = uriMatch[1];
                  break;
                }
              }
            }

            // If no explicit audio track, try to find a low-bandwidth stream
            if (!audioPlaylistUrl) {
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1]?.startsWith('http')) {
                  const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
                  const bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;
                  // Take lowest bandwidth stream (likely audio-only or low quality)
                  if (bandwidth > 0 && bandwidth < 200000) {
                    audioPlaylistUrl = lines[i + 1].trim();
                    break;
                  }
                }
              }
            }

            if (audioPlaylistUrl) {
              console.log(`Found HLS audio stream, downloading...`);
              const data = await downloadAsBase64(audioPlaylistUrl, 'https://www.youtube.com/');
              if (data) {
                return { ...data, filename: `youtube_${videoId}.m4a` };
              }
            }
          }
        } catch (hlsErr) {
          console.warn('HLS fallback failed:', hlsErr);
        }
      }

      if (tryFormats.length === 0 && cipherAudioFormats.length === 0 && !hlsUrl) {
        console.error(`${client.name}: No formats found at all`);
      } else {
        console.error(`${client.name}: All format downloads failed`);
      }
    } catch (e) {
      console.error(`YouTube ${client.name} error:`, e);
    }
  }

  console.log('All YouTube Innertube strategies failed');
  return null;
}

// ─── Download helper ────────────────────────────────────────────────────────
function looksLikeMedia(url: string, contentType?: string): boolean {
  if (contentType) {
    if (contentType.startsWith('audio/') || contentType.startsWith('video/')) return true;
    if (contentType === 'application/octet-stream') return true;
  }
  return /\.(mp3|mp4|m4a|wav|ogg|webm|mov|aac|flac)(\?|$)/i.test(url);
}

async function downloadAsBase64(
  url: string,
  referer?: string,
  cookie?: string,
): Promise<{ base64: string; contentType: string; size: number } | null> {
  try {
    console.log(`Downloading: ${url.substring(0, 120)}...`);
    // Vetted the same way as the caller's own URL: this is the call that puts
    // the bytes in the response, and a CDN URL handed back by Cobalt or TikTok
    // is no more trusted than one the caller typed.
    const { response: resp } = await safeFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        'Referer': referer || new URL(url).origin + '/',
        // TikTok's CDN rejects requests without a byte range and without the
        // session cookies handed out by the page request (403 Forbidden).
        'Range': 'bytes=0-',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: AbortSignal.timeout(120000),
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
    const base64 = encodeBase64(new Uint8Array(arrayBuffer));
    return { base64, contentType, size };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      console.error('Download timed out');
    } else {
      console.error(`Download error:`, e);
    }
    return null;
  }
}

// ─── TikTok ─────────────────────────────────────────────────────────────────
// Keyless resolver mirrors. These return a direct, cookie-free media URL, which
// is what saves us when TikTok's own CDN rejects the signed playAddr (403).
async function downloadTikTokViaMirror(
  videoId: string,
  wantVideo = false,
): Promise<{ base64: string; contentType: string; size: number; filename: string } | null> {
  const endpoints = [
    `https://tikwm.com/api/?url=https://www.tiktok.com/video/${videoId}&hd=0`,
    `https://www.tikwm.com/api/?url=https://www.tiktok.com/video/${videoId}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const resp = await fetch(endpoint, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!resp.ok) {
        console.warn(`TikTok mirror ${endpoint} returned ${resp.status}`);
        continue;
      }
      const json = await resp.json();
      const d = json?.data ?? {};
      const candidates = (wantVideo ? [d.play, d.hdplay, d.wmplay] : [d.music, d.play, d.wmplay, d.hdplay])
        .filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
        .map((u: string) => (u.startsWith('http') ? u : `https://tikwm.com${u}`));

      for (const mediaUrl of candidates) {
        const data = await downloadAsBase64(mediaUrl, 'https://tikwm.com/');
        if (data) {
          const isAudio = data.contentType.startsWith('audio/') || /\.mp3(\?|$)/i.test(mediaUrl);
          return { ...data, filename: `tiktok_${videoId}.${isAudio ? 'mp3' : 'mp4'}` };
        }
      }
    } catch (e) {
      console.warn(`TikTok mirror ${endpoint} error:`, e);
    }
  }

  return null;
}

async function downloadTikTok(url: string, wantVideo = false): Promise<{ base64: string; contentType: string; size: number; filename: string } | null> {

  console.log('Trying TikTok-specific download...');

  try {
    const resolveResp = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      },
      signal: AbortSignal.timeout(15000),
    });

    const finalUrl = resolveResp.url;
    console.log(`Resolved to: ${finalUrl}`);

    const videoIdMatch = finalUrl.match(/\/video\/(\d+)/);
    if (!videoIdMatch) {
      console.error('Could not extract TikTok video ID');
      return null;
    }

    const videoId = videoIdMatch[1];
    console.log(`TikTok video ID: ${videoId}`);

    const oembedUrl = `https://www.tiktok.com/oembed?url=https://www.tiktok.com/video/${videoId}`;
    const oembedResp = await fetch(oembedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot)' },
    });

    if (oembedResp.ok) {
      const oembedData = await oembedResp.json();
      console.log(`oEmbed title: ${oembedData.title?.substring(0, 50)}`);
    }

    const html = await resolveResp.text();

    const videoUrls: string[] = [];

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

    const genericPattern = /https?:[\\\/]+[^"'\s]+v\d+-[^"'\s]+\.(?:mp4|mp3|m4a)(?:[^"'\s]*)/gi;
    let gMatch;
    while ((gMatch = genericPattern.exec(html)) !== null) {
      const decoded = gMatch[0]
        .replace(/\\u002F/g, '/')
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/');
      videoUrls.push(decoded);
    }

    const uniqueUrls = [...new Set(videoUrls)];
    console.log(`Found ${uniqueUrls.length} TikTok video URL candidates`);

    // Cookies handed out by the page request; the CDN 403s without them.
    const cookie = (resolveResp.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(';')[0])
      .join('; ');

    for (const videoUrl of uniqueUrls.slice(0, 5)) {
      const data = await downloadAsBase64(videoUrl, finalUrl, cookie);
      if (data) {
        return {
          ...data,
          filename: `tiktok_${videoId}.mp4`,
        };
      }
    }

    console.log('All TikTok CDN URLs failed, trying resolver mirrors...');
    const mirror = await downloadTikTokViaMirror(videoId, wantVideo);
    if (mirror) return mirror;

    console.log('All TikTok video URLs failed to download');
    return null;

  } catch (e) {
    console.error('TikTok download error:', e);
    return null;
  }
}

// ─── Main handler ───────────────────────────────────────────────────────────
serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Authenticate: either a signed-in user JWT, or an internal
    // server-to-server call from the video pipeline (service-role key).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const token = authHeader.slice('Bearer '.length).trim();
    const isInternalServiceCall = token === (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '\u0000');

    if (!isInternalServiceCall) {
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
    } else {
      console.log('download-media: internal service-role call');
    }


    // `wantVideo` asks for the pictures as well as the sound. The default is
    // still audio-only: every ASR caller wants the smallest payload that has
    // the speech in it, and only the on-screen-text re-read needs the frames.
    const { url, bypassCache, wantVideo: wantVideoRaw } = await req.json();
    const wantVideo = wantVideoRaw === true;

    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for cached result unless explicitly bypassed. The cache holds a
    // previous run's transcription, which is no answer at all to "give me the
    // video file", so a video request always skips it.
    if (!bypassCache && !wantVideo) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (supabaseUrl && supabaseKey) {
          const supabase = createClient(supabaseUrl, supabaseKey);

          const parsedUrl = new URL(url);
          const hostname = parsedUrl.hostname.replace(/^www\./, '').replace(/^m\./, '');

          let platform = 'other';
          let videoId = '';

          if (hostname.includes('youtube.com') || hostname === 'youtu.be') {
            platform = 'youtube';
            videoId = extractYouTubeVideoId(url) || '';
          } else if (hostname.includes('tiktok.com')) {
            platform = 'tiktok';
            const match = url.match(/\/video\/(\d+)/);
            videoId = match?.[1] || '';
          }

          if (videoId) {
            const contentHash = `${platform}:${videoId}`;

            const { data: cached, error: cacheError } = await supabase
              .from('processed_videos')
              .select('*')
              .eq('content_hash', contentHash)
              .maybeSingle();

            if (!cacheError && cached) {
              const processedAt = new Date(cached.processed_at);
              const now = new Date();
              const ageInDays = (now.getTime() - processedAt.getTime()) / (1000 * 60 * 60 * 24);

              if (ageInDays < 30) {
                console.log(`Cache hit for ${contentHash} (${ageInDays.toFixed(1)} days old)`);
                return new Response(
                  JSON.stringify({
                    cached: true,
                    transcriptionData: cached.transcription_data,
                    cacheAge: ageInDays,
                    processingEngines: cached.processing_engines,
                  }),
                  {
                    status: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                  }
                );
              } else {
                console.log(`Cache expired for ${contentHash} (${ageInDays.toFixed(1)} days old)`);
              }
            }
          }
        }
      } catch (cacheCheckError) {
        console.warn('Cache check failed (continuing with download):', cacheCheckError);
      }
    }

    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    console.log(`Processing URL: ${normalizedUrl}`);

    // Strategy 1 below fetches this URL directly and hands the bytes back to
    // the caller, so an unvetted host here is an SSRF with the response
    // attached. `assertPublicHttpUrl` refuses loopback, private and
    // link-local destinations — cloud instance metadata above all — and
    // `safeFetch` re-checks each redirect hop rather than letting the runtime
    // follow one into the same place.
    try {
      assertPublicHttpUrl(normalizedUrl);
    } catch (e: unknown) {
      return new Response(
        JSON.stringify({
          error: e instanceof BlockedUrlError ? e.message : "Invalid URL format",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const makeSuccessResponse = (result: { base64: string; contentType: string; size: number; filename: string }, extras?: Record<string, unknown>) =>
      new Response(
        JSON.stringify({
          // `audioBase64` is the long-standing field name and every existing
          // caller reads it; `mediaBase64` is the same bytes under a name that
          // does not lie when the payload is a video.
          audioBase64: result.base64,
          mediaBase64: result.base64,
          contentType: result.contentType,
          size: result.size,
          filename: result.filename,
          originalUrl: normalizedUrl,
          ...extras,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    // Strategy 1: Direct media file check
    try {
      const { response: headResp, finalUrl } = await safeFetch(normalizedUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000),
      });
      const ct = headResp.headers.get('content-type') || '';

      if (looksLikeMedia(finalUrl, ct)) {
        console.log(`Direct media URL detected (${ct}), downloading...`);
        const audioData = await downloadAsBase64(finalUrl);
        if (audioData) {
          return makeSuccessResponse({
            ...audioData,
            filename: new URL(finalUrl).pathname.split('/').pop() || 'audio.mp4',
          });
        }
      }
    } catch (e) {
      console.log("HEAD check failed:", e);
    }

    // Strategy 2: TikTok-specific download
    if (isTikTokUrl(normalizedUrl)) {
      const tiktokResult = await downloadTikTok(normalizedUrl, wantVideo);
      if (tiktokResult) return makeSuccessResponse(tiktokResult);
    }

    // For YouTube: Cobalt first (most reliable), then RapidAPI, then Innertube
    if (isYouTubeUrl(normalizedUrl)) {
      // Strategy 3a: Cobalt API (most reliable for YouTube)
      console.log('=== YouTube: trying Cobalt first ===');
      const cobaltResult = await downloadViaCobalt(normalizedUrl, wantVideo);
      if (cobaltResult) return makeSuccessResponse(cobaltResult);

      // The remaining YouTube strategies are audio-only extractors, so they
      // cannot answer a video request — better to fail than to hand back a
      // soundtrack to something that wanted to look at the frames.
      if (!wantVideo) {
        // Strategy 3b: RapidAPI services
        console.log('=== YouTube: trying RapidAPI ===');
        const rapidResult = await downloadYouTubeViaRapidApi(normalizedUrl);
        if (rapidResult) return makeSuccessResponse(rapidResult);

        // Strategy 3c: Innertube API (direct YouTube API — least reliable due to PO tokens)
        console.log('=== YouTube: trying Innertube ===');
        const ytResult = await downloadYouTubeViaInnertube(normalizedUrl);
        if (ytResult) return makeSuccessResponse(ytResult);
      }
    } else if (isSocialMediaUrl(normalizedUrl)) {
      // For other social media: Cobalt is the primary strategy
      const cobaltResult = await downloadViaCobalt(normalizedUrl, wantVideo);
      if (cobaltResult) return makeSuccessResponse(cobaltResult);
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
