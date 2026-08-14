import { supabase } from "@/integrations/supabase/client";

/**
 * Extensions the `video-audio` bucket is staged under, in the order the
 * pipeline resolves them.
 *
 * This list has to match `storagePaths` in
 * `supabase/functions/process-approved-video/index.ts`. When the admin upload
 * form started extracting the audio track client-side it began staging WAV,
 * and the edge function learned to read it — but the three browser-side
 * readers kept looking for the old containers only. The effect was invisible
 * server-side and total in the player: every video uploaded since had audio
 * the pipeline could find and the app could not, which is what silently killed
 * TikTok's hidden-audio playback (no line sync, no phrase pause, no view
 * tracking — the page falls back to the legacy manual timer).
 *
 * `.wav` leads for the same reason it leads server-side: when both exist it is
 * the extracted audio track rather than a whole video file that happens to
 * carry one.
 */
export const STAGED_AUDIO_EXTENSIONS = [
  ".wav",
  ".mp4",
  ".m4a",
  ".webm",
  ".mp3",
  ".opus",
] as const;

/**
 * Signed URL for a video's staged audio in the private `video-audio` bucket,
 * or null when nothing is staged for it yet (e.g. transcription still pending,
 * or a URL-sourced video nobody uploaded a file for).
 */
export async function resolveStagedVideoAudioUrl(
  key: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  for (const ext of STAGED_AUDIO_EXTENSIONS) {
    const { data } = await supabase.storage
      .from("video-audio")
      .createSignedUrl(`${key}${ext}`, expiresInSeconds);
    if (data?.signedUrl) return data.signedUrl;
  }
  return null;
}
