/**
 * A transcript line as something to shadow.
 *
 * Two pages put a "repeat after the native speaker" card under a line of a
 * Discover video — the video page itself and the post-video debrief — and both
 * need the same answer to "what does the learner listen to?". It used to be a
 * private helper of the video page.
 */
import { DIALECT_LOCALE, extractYouTubeId, type ShadowClip } from "@/hooks/useShadowQueue";

export interface ClipLine {
  id: string;
  arabic: string;
  translation?: string;
  startMs?: number;
  endMs?: number;
}

export interface ClipVideo {
  platform?: string | null;
  embed_url?: string | null;
  source_url?: string | null;
  dialect: string;
  title: string;
}

/**
 * The clip for one line, or null when there is nothing to play.
 *
 * A downloadable native-audio clip is preferred whenever one exists. An
 * `<audio>` element started by the learner's tap plays reliably on every
 * platform; the cross-origin YouTube iframe refuses to autoplay until the
 * learner has interacted inside it (which is why shadowing used to need the
 * main video played first). The iframe is the fallback only when no audio
 * file exists. Either way the reference stays the actual native clip — and a
 * line without timings has no clip at all.
 */
export function buildLineShadowClip(
  line: ClipLine,
  video: ClipVideo | null | undefined,
  audioUrl?: string | null,
): ShadowClip | null {
  const startMs = Number(line.startMs);
  const endMs = Number(line.endMs);
  const hasTiming = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
  if (!video || !line.arabic || !hasTiming) return null;

  const base = {
    id: `line-${line.id}`,
    text: line.arabic,
    translation: line.translation,
    startSec: startMs / 1000,
    endSec: endMs / 1000,
    dialect: video.dialect,
    locale: DIALECT_LOCALE[video.dialect] ?? "ar-SA",
    sourceTitle: video.title,
  };

  if (audioUrl) return { ...base, source: "audio", audioUrl };
  const youtubeId =
    video.platform === "youtube" ? extractYouTubeId(video.embed_url ?? null, video.source_url ?? null) : null;
  if (youtubeId) return { ...base, source: "youtube", youtubeId };
  return null;
}
