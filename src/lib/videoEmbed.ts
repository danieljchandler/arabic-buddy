/**
 * Extract video ID and platform from various URL formats
 */
export function parseVideoUrl(url: string): { platform: string; videoId: string; embedUrl: string } | null {
  // YouTube
  const ytMatch = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  if (ytMatch) {
    return {
      platform: "youtube",
      videoId: ytMatch[1],
      embedUrl: `https://www.youtube.com/embed/${ytMatch[1]}?enablejsapi=1&origin=${window.location.origin}`,
    };
  }

  // TikTok (full URL with video ID)
  const ttMatch = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
  if (ttMatch) {
    return {
      platform: "tiktok",
      videoId: ttMatch[1],
      embedUrl: `https://www.tiktok.com/embed/v2/${ttMatch[1]}`,
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

/**
 * Get YouTube thumbnail URL
 */
export function getYouTubeThumbnail(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Format seconds to mm:ss
 */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
