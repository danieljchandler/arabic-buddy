/**
 * Every shape a YouTube id turns up in.
 *
 * Watch, shorts, live and youtu.be are what an admin pastes; `embed/` covers
 * both youtube.com and the youtube-nocookie.com host the player is actually
 * pointed at, which is what `embed_url` holds on every row; `vi/` and
 * `vi_webp/` cover the CDN's own thumbnail URLs. Anywhere a row carries a URL,
 * this is how the id comes back out of it.
 */
const YOUTUBE_ID =
  /(?:(?:youtube(?:-nocookie)?|ytimg)\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/|vi(?:_webp)?\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

/**
 * The YouTube video a URL refers to, whatever kind of URL it is, or null when
 * it is not a YouTube URL at all.
 */
export function getYouTubeVideoId(url: string | null | undefined): string | null {
  return url?.match(YOUTUBE_ID)?.[1] ?? null;
}

/**
 * Extract video ID and platform from various URL formats
 */
export function parseVideoUrl(url: string): { platform: string; videoId: string; embedUrl: string } | null {
  // YouTube
  const youtubeId = getYouTubeVideoId(url);
  if (youtubeId) {
    return {
      platform: "youtube",
      videoId: youtubeId,
      // Use youtube-nocookie.com to avoid sign-in / consent prompts in embeds
      embedUrl: `https://www.youtube-nocookie.com/embed/${youtubeId}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1&origin=${window.location.origin}`,
    };
  }

  // TikTok (full URL with video ID)
  const ttMatch = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
  if (ttMatch) {
    return {
      platform: "tiktok",
      videoId: ttMatch[1],
      embedUrl: `https://www.tiktok.com/player/v1/${ttMatch[1]}`,
    };
  }

  // TikTok short URL (vt.tiktok.com or vm.tiktok.com) — can't extract ID, use URL directly
  if (/(?:vt|vm)\.tiktok\.com\//.test(url)) {
    return {
      platform: "tiktok",
      videoId: "",
      embedUrl: url,
    };
  }

  // Instagram Reel
  const igMatch = url.match(/instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]+)/);
  if (igMatch) {
    return {
      platform: "instagram",
      videoId: igMatch[1],
      embedUrl: `https://www.instagram.com/p/${igMatch[1]}/embed`,
    };
  }

  return null;
}


export function extractTikTokVideoId(value: string): string | null {
  if (!value) return null;

  const match = value.match(/(?:video\/|embed\/v2\/|player\/v1\/|\/v\/|item_id=)(\d{8,})/);
  return match?.[1] ?? null;
}

/**
 * Normalize any TikTok URL to a valid embeddable URL when possible.
 */
export function getTikTokEmbedUrl(url: string): string | null {
  if (!url) return null;

  const fromPathId = extractTikTokVideoId(url);
  if (fromPathId) {
    return `https://www.tiktok.com/player/v1/${fromPathId}`;
  }

  try {
    const parsed = new URL(url);
    const byQuery = parsed.searchParams.get("video_id");
    if (byQuery && /^\d{8,}$/.test(byQuery)) {
      return `https://www.tiktok.com/player/v1/${byQuery}`;
    }
  } catch {
    // Ignore invalid URL shapes; regex fallback above already attempted.
  }

  return null;
}

/**
 * YouTube still sizes, largest first.
 *
 * `hqdefault` is the only one guaranteed to exist, which is why it was the
 * safe choice — but it is 480x360, and YouTube letterboxes the widescreen
 * frame into that 4:3 box. On a card that is 16:9 (Discover) or full-bleed
 * vertical (the feed) that still gets blown up two to four times its own
 * size, which is what makes the grid look cheap. `maxresdefault` is 1280x720
 * or better and is un-letterboxed, so it is worth asking for first and
 * stepping down when a video has not had one generated.
 */
export const YOUTUBE_THUMBNAIL_QUALITIES = [
  "maxresdefault",
  "sddefault",
  "hqdefault",
] as const;

export type YouTubeThumbnailQuality = (typeof YOUTUBE_THUMBNAIL_QUALITIES)[number];

/**
 * A missing still is usually a 404, but YouTube sometimes answers 200 with a
 * 120x90 grey placeholder instead. Nothing real in the ladder above is that
 * narrow, so a decoded width at or under this is a miss to be stepped past.
 */
export const YOUTUBE_PLACEHOLDER_WIDTH = 120;

/**
 * Get YouTube thumbnail URL.
 *
 * `i.ytimg.com` rather than `img.youtube.com`: the latter is a redirect to
 * the former, so pointing at it directly saves every card a round trip.
 */
export function getYouTubeThumbnail(
  videoId: string,
  quality: YouTubeThumbnailQuality = "maxresdefault"
): string {
  return `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`;
}

/** The URLs a row carries besides its thumbnail, in the order worth trying. */
export interface ThumbnailSources {
  source_url?: string | null;
  embed_url?: string | null;
}

/**
 * The stills to try for a video, best first.
 *
 * Two problems are solved in one place, both of them without a backfill.
 *
 * Rows written before we asked for `maxresdefault` still hold `hqdefault`
 * URLs, and the trending importer stores whatever the Data API returned — so
 * any YouTube URL is re-derived from its video id at the size we actually
 * want, whatever size and host it was stored at.
 *
 * And a YouTube still is a pure function of the video id, which the row
 * already carries in `source_url` and `embed_url`. A row whose `thumbnail_url`
 * was never filled in — an oEmbed that came back empty, an import that
 * predates thumbnails — does not need one written to it to show a still; it
 * only needs asking.
 *
 * What is left over is genuinely stored-or-nothing: TikTok and Instagram
 * stills are signed CDN URLs that can be neither rewritten nor guessed.
 */
export function getThumbnailCandidates(
  url: string | null | undefined,
  sources?: ThumbnailSources | null,
): string[] {
  const videoId =
    getYouTubeVideoId(url) ??
    getYouTubeVideoId(sources?.source_url) ??
    getYouTubeVideoId(sources?.embed_url);

  if (videoId) {
    return YOUTUBE_THUMBNAIL_QUALITIES.map((quality) => getYouTubeThumbnail(videoId, quality));
  }

  return url ? [url] : [];
}

/**
 * Format seconds to mm:ss
 */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
