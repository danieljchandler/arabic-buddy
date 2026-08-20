/**
 * Deterministic first pass over a shared payload: work out where it belongs
 * without spending an AI call. Anything that needs judgement (free text,
 * screenshots) is marked for the screen-shared-content function instead.
 *
 * Pure module — no React, no supabase — so the routing table is unit-testable.
 */

export type ShareRoute =
  /** Open a feature with the payload pre-loaded. */
  | { action: "transcribe-file"; file: File }
  | { action: "transcribe-url"; url: string }
  | { action: "meme-file"; file: File }
  | { action: "learn-from-x"; url: string }
  /** Admin one-step Discover ingestion (TikTok / YouTube / Instagram link). */
  | { action: "video-pipeline"; url: string }
  /** Video link shared by a non-admin — no feature accepts these. */
  | { action: "video-url-unsupported"; url: string }
  /** A file whose type no feature can take — named, so the UI can say which. */
  | { action: "file-unsupported"; file: File }
  /** Needs the AI screening call. */
  | { action: "screen-text"; text: string }
  | { action: "screen-image"; file: File }
  /** Nothing usable in the payload. */
  | { action: "empty" };

export interface ShareInput {
  title: string;
  text: string;
  url: string;
  files: File[];
  isAdmin: boolean;
}

const X_STATUS_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i;

const VIDEO_PLATFORM_HOSTS = [
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "instagram.com",
];

export function isVideoPlatformUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "");
    return VIDEO_PLATFORM_HOSTS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * Android share sheets deliver URLs inconsistently: sometimes in `url`,
 * sometimes as the whole `text`, sometimes buried inside a caption ("Check
 * this out! https://vt.tiktok.com/xyz"). Take the explicit field first, then
 * the first http(s) URL found in the text.
 */
export function extractSharedUrl(input: Pick<ShareInput, "text" | "url">): string | null {
  const direct = input.url.trim();
  if (/^https?:\/\//i.test(direct)) return direct;
  const inText = input.text.match(/https?:\/\/\S+/i);
  return inText ? inText[0].replace(/[)\],.;!?]+$/, "") : null;
}

/** The text minus any URL it carried — a caption worth screening on its own. */
function textWithoutUrl(text: string, url: string | null): string {
  return (url ? text.replace(url, " ") : text).trim();
}

/**
 * Android share sheets routinely hand over a file with an empty `type` —
 * voice notes from messaging apps, anything routed through a download
 * manager. Classifying those by MIME alone dropped the file silently, so the
 * learner who just shared a recording got an empty paste box and no
 * explanation. The extension is the only other thing we have.
 */
const AUDIO_EXT_RE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|amr|flac|wma|3gp|caf)$/i;
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi|3gpp)$/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|heic|heif|bmp|avif)$/i;

type SharedFileKind = "audio" | "video" | "image" | null;

export function classifySharedFile(file: File): SharedFileKind {
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  // No usable MIME type: fall back to the filename, the way Transcribe's own
  // picker already does.
  if (AUDIO_EXT_RE.test(file.name)) return "audio";
  if (VIDEO_EXT_RE.test(file.name)) return "video";
  if (IMAGE_EXT_RE.test(file.name)) return "image";
  return null;
}

export function classifyShare(input: ShareInput): ShareRoute {
  const file = input.files[0];
  if (file) {
    const kind = classifySharedFile(file);
    if (kind === "audio") return { action: "transcribe-file", file };
    if (kind === "video") {
      // Transcribe's video path is admin-only; the public meme analyzer
      // handles short video clips (frames + audio) for everyone else.
      return input.isAdmin ? { action: "transcribe-file", file } : { action: "meme-file", file };
    }
    if (kind === "image") return { action: "screen-image", file };
    // Something was shared and we cannot use it. Saying so beats an empty
    // box that reads as the share having failed to arrive at all.
    return { action: "file-unsupported", file };
  }

  const url = extractSharedUrl(input);
  if (url) {
    if (X_STATUS_RE.test(url)) return { action: "learn-from-x", url };
    if (isVideoPlatformUrl(url)) {
      return input.isAdmin
        ? { action: "video-pipeline", url }
        : { action: "video-url-unsupported", url };
    }
    // Unknown link: screen whatever caption came with it, or the URL itself
    // tells us nothing — fall through to text screening / empty.
    const caption = textWithoutUrl(input.text, url);
    if (caption) return { action: "screen-text", text: caption };
    return { action: "empty" };
  }

  const text = input.text.trim() || input.title.trim();
  if (text) return { action: "screen-text", text };

  return { action: "empty" };
}
