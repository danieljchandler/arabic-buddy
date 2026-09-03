/**
 * Keeping our own copy of a video still.
 *
 * The stills TikTok (and Meta) hand out are signed URLs that expire in about
 * forty-eight hours — see `thumbnailUrlCore.ts` for what that looked like from
 * the outside. Nothing about the picture changes when the signature does, so
 * the fix is to fetch the bytes once, while the signature is good, and put
 * them in the bucket we already serve every other generated image from. What
 * goes on the row after that is a URL of ours, which does not expire.
 *
 * The copy has to happen server-side. `p16-*.tiktokcdn-us.com` serves the
 * image happily but sends no `Access-Control-Allow-Origin`, so a browser can
 * display those bytes and cannot read them; only a function holding the
 * service role can do the download-and-upload.
 */

import { isEphemeralThumbnailUrl } from "./thumbnailUrlCore.ts";

/** Public, admin-write, and already where captured video frames go. */
export const THUMBNAIL_BUCKET = "flashcard-images";
export const THUMBNAIL_PREFIX = "video-stills";

/** Bigger than any thumbnail and small enough that a wrong URL can't hurt. */
const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** The slice of a Supabase client this needs, so tests can pass a stub. */
export interface ThumbnailStorage {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Uint8Array | ArrayBuffer | Blob,
        options?: { contentType?: string; upsert?: boolean },
      ): Promise<{ error: { message: string } | null }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
}

export interface MirrorResult {
  /** The URL to store on the row. */
  url: string;
  /** False when the source was already permanent and was left alone. */
  mirrored: boolean;
}

interface MirrorOptions {
  /**
   * What the stored object is named after — the video's row id, or its
   * platform id when the row does not exist yet. Stable on purpose: fetching
   * the same video's still twice overwrites one object instead of littering
   * the bucket.
   */
  key: string;
  url: string;
  fetchImpl?: typeof fetch;
}

/**
 * Fetch a still and put it in our bucket, returning the durable URL.
 *
 * Null rather than a throw when the copy cannot be made: a still is worth
 * less than the row it belongs to, and every caller has something sensible to
 * do with "no" — usually storing the borrowed URL, which is a picture for two
 * days rather than none at all.
 */
export async function mirrorThumbnail(
  client: ThumbnailStorage,
  { key, url, fetchImpl = fetch }: MirrorOptions,
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      // The CDN answers plain GETs, but an expired signature comes back as a
      // 403 with an XML body — which is exactly the case this runs into, so
      // the content-type check below is load-bearing, not belt-and-braces.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; arabic-buddy/1.0)" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.warn("[thumbnailMirror] fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }

  if (!response.ok) {
    response.body?.cancel();
    console.warn(`[thumbnailMirror] source answered ${response.status} for ${key}`);
    return null;
  }

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    response.body?.cancel();
    console.warn(`[thumbnailMirror] source served ${contentType || "no content type"} for ${key}`);
    return null;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_THUMBNAIL_BYTES) {
    console.warn(`[thumbnailMirror] refusing ${bytes.byteLength} bytes for ${key}`);
    return null;
  }

  const path = `${THUMBNAIL_PREFIX}/${key}.${EXTENSIONS[contentType] ?? "jpg"}`;
  const bucket = client.storage.from(THUMBNAIL_BUCKET);
  const { error } = await bucket.upload(path, bytes, { contentType, upsert: true });
  if (error) {
    console.warn(`[thumbnailMirror] upload failed for ${key}: ${error.message}`);
    return null;
  }

  return bucket.getPublicUrl(path).data.publicUrl;
}

/**
 * The URL to store for a still: a copy of our own when the one we were given
 * expires, and the original untouched when it does not.
 *
 * `i.ytimg.com` addresses go through here unchanged, which is what we want —
 * they are permanent, and copying them would spend storage to make a picture
 * that is already stable slightly less stable.
 */
export async function ensureDurableThumbnail(
  client: ThumbnailStorage,
  { key, url, fetchImpl }: MirrorOptions,
): Promise<MirrorResult | null> {
  if (!url) return null;
  if (!isEphemeralThumbnailUrl(url)) return { url, mirrored: false };

  const mirrored = await mirrorThumbnail(client, { key, url, fetchImpl });
  return mirrored ? { url: mirrored, mirrored: true } : { url, mirrored: false };
}

/**
 * The still a platform will give us for a video, or null.
 *
 * TikTok's oEmbed is public, unauthenticated and the same endpoint the admin
 * form calls. Instagram has an oEmbed too, but it needs a Facebook app token,
 * so Instagram rows have no answer here and fall back to capturing a frame
 * from the uploaded file.
 */
export async function fetchTikTokThumbnail(
  sourceUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; arabic-buddy/1.0)" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data?.thumbnail_url === "string" && data.thumbnail_url ? data.thumbnail_url : null;
  } catch {
    // A deleted or private video 404s, and the network can simply fail. Either
    // way this is a row to report on, not an exception to raise.
    return null;
  }
}

/**
 * The permanent YouTube still for a URL, or null when it is not YouTube.
 *
 * Twin of `getYouTubeVideoId` in `src/lib/videoEmbed.ts`, which cannot be
 * imported here (its neighbours read `window.location`). `maxresdefault` is
 * what the client's ladder asks for first.
 */
const YOUTUBE_ID =
  /(?:(?:youtube(?:-nocookie)?|ytimg)\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/|vi(?:_webp)?\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export function youTubeThumbnail(...urls: (string | null | undefined)[]): string | null {
  for (const url of urls) {
    const id = url?.match(YOUTUBE_ID)?.[1];
    if (id) return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
  }
  return null;
}
