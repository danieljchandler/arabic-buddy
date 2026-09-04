/**
 * Vocabulary Audio Context Extraction
 * 
 * Extracts sentence/word audio clips when saving vocabulary words
 * from pages with audio/video sources (transcripts, videos, etc.)
 */

import { supabase } from "@/integrations/supabase/client";
import { clipToWav, decodeAudioFile } from "./audioClipper";

export interface AudioContext {
  sentenceAudioUrl?: string;
  wordAudioUrl?: string;
  sentenceText?: string;
  sentenceEnglish?: string;
}

export interface TimingContext {
  startMs: number;
  endMs: number;
  wordStartMs?: number;
  wordEndMs?: number;
}

/**
 * Extract audio clip from a media URL using timing data
 */
export async function extractAudioClipFromUrl(
  audioUrl: string,
  startMs: number,
  endMs: number
): Promise<Blob | null> {
  try {
    // Fetch the audio file
    const response = await fetch(audioUrl);
    if (!response.ok) {
      console.warn("Failed to fetch audio:", response.status);
      return null;
    }

    const blob = await response.blob();
    const file = new File([blob], "source.mp3", { type: blob.type });
    
    // Decode and clip
    const audioBuffer = await decodeAudioFile(file);
    const clipBlob = clipToWav(audioBuffer, startMs, endMs);
    
    return clipBlob;
  } catch (err) {
    console.warn("Audio extraction failed:", err);
    return null;
  }
}

/**
 * Extract audio clip from a DOM media element (video/audio)
 */
export async function extractAudioClipFromElement(
  element: HTMLMediaElement,
  startMs: number,
  endMs: number
): Promise<Blob | null> {
  try {
    const src = element.currentSrc || element.src;
    if (!src) return null;
    
    return extractAudioClipFromUrl(src, startMs, endMs);
  } catch (err) {
    console.warn("Audio extraction from element failed:", err);
    return null;
  }
}

/**
 * Upload audio blob to Supabase storage
 */
export async function uploadAudioClip(
  blob: Blob,
  userId: string,
  prefix: string = "sentence"
): Promise<string | null> {
  try {
    const filename = `${prefix}_${userId}_${Date.now()}.wav`;
    const path = `clips/${userId}/${filename}`;

    const { error } = await supabase.storage
      .from("flashcard-audio")
      .upload(path, blob, {
        contentType: "audio/wav",
        upsert: false,
      });

    if (error) {
      console.error("Upload error:", error);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from("flashcard-audio")
      .getPublicUrl(path);

    return urlData.publicUrl;
  } catch (err) {
    console.error("Upload failed:", err);
    return null;
  }
}

/**
 * Full pipeline: extract audio from URL, clip it, and upload
 */
export async function extractAndUploadAudioClip(
  audioUrl: string,
  startMs: number,
  endMs: number,
  userId: string,
  prefix: string = "sentence"
): Promise<string | null> {
  const clipBlob = await extractAudioClipFromUrl(audioUrl, startMs, endMs);
  if (!clipBlob) return null;

  return uploadAudioClip(clipBlob, userId, prefix);
}

/**
 * Fallback: synthesize TTS for a piece of Arabic text and upload it to
 * `flashcard-audio`, returning a public URL. Used when native video audio
 * is not available (e.g. YouTube Discover videos without an extracted
 * audio track) so the flashcard still has a saved audio clip.
 */
export async function synthesizeAndUploadTTS(
  text: string,
  userId: string,
  dialect: string | null | undefined,
  prefix: string = "tts",
): Promise<string | null> {
  if (!text?.trim()) return null;
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token ?? anonKey;

    const call = (fn: string, body: Record<string, unknown>) =>
      fetch(`${supabaseUrl}/functions/v1/${fn}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          apikey: anonKey,
        },
        body: JSON.stringify(body),
      });

    // The server routes the dialect. This file used to keep its own Munsit
    // dialect set that included Yemeni while useAzureTTS's excluded it, so the
    // same Yemeni word was voiced differently depending on which path reached it.
    let response = await call("tts-speak", { text, dialect });
    let ct = response.headers.get("content-type") ?? "";
    if (!response.ok || !ct.startsWith("audio/")) {
      response = await call("azure-tts", { text });
      ct = response.headers.get("content-type") ?? "";
    }
    if (!response.ok || !ct.startsWith("audio/")) return null;

    const blob = await response.blob();
    const ext = ct.includes("wav") ? "wav" : ct.includes("mp3") || ct.includes("mpeg") ? "mp3" : "audio";
    const path = `tts/${userId}/${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from("flashcard-audio")
      .upload(path, blob, { contentType: ct, upsert: false });
    if (error) {
      console.warn("TTS upload failed:", error);
      return null;
    }
    return supabase.storage.from("flashcard-audio").getPublicUrl(path).data.publicUrl;
  } catch (err) {
    console.warn("synthesizeAndUploadTTS failed:", err);
    return null;
  }
}

/**
 * Resolve a fetchable audio URL for a Discover video.
 *
 * The audio copy lives in the private `video-audio` bucket, whose SELECT
 * policies admit reviewers and admins only, so a learner cannot sign a URL
 * for it from the browser — every attempt used to cost twelve failing
 * storage calls (six extensions × two keys) and end in silent timer mode.
 * A signed-in caller now asks `discover-video-audio` once; it signs under
 * the service role for a published video and says `no_audio` when nothing is
 * staged. A signed-out visitor makes no request at all: the function would
 * only answer 401. The legacy public `audio` bucket (`audio_files`) remains
 * the last resort for old YouTube-keyed clips.
 */
export async function resolveDiscoverVideoAudioUrl(video: {
  id?: string;
  source_url?: string;
  embed_url?: string;
}): Promise<string | null> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const signedIn = Boolean(sessionData?.session);

    if (video.id && signedIn) {
      const { data, error } = await supabase.functions.invoke<{ url?: string | null; reason?: string }>(
        "discover-video-audio",
        { body: { videoId: video.id } },
      );
      if (!error && data?.url) return data.url;
      // `no_audio` (nothing staged) and any failure both fall through to the
      // legacy lookups, which cost one REST read at most.
    }

    // Legacy YouTube id-based files: the public `audio` bucket via `audio_files`.
    const url = video.source_url || video.embed_url || "";
    const ytMatch = url.match(
      /(?:youtube\.com\/(?:shorts\/|watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/
    );
    const videoId = ytMatch?.[1];

    if (videoId) {
      const { data: audioRecord } = await supabase
        .from("audio_files")
        .select("storage_path")
        .eq("video_id", videoId)
        .limit(1)
        .maybeSingle();
      if (audioRecord?.storage_path) {
        const { data: urlData } = supabase.storage
          .from("audio")
          .getPublicUrl(audioRecord.storage_path);
        if (urlData?.publicUrl) return urlData.publicUrl;
      }
    }
  } catch (err) {
    console.warn("resolveDiscoverVideoAudioUrl failed:", err);
  }
  return null;
}

/**
 * Find the first transcript line containing a given word
 */
export function findLineContainingWord(
  lines: Array<{ arabic: string; translation?: string; startMs?: number; endMs?: number }>,
  wordArabic: string
): { sentenceText: string; sentenceEnglish?: string; startMs?: number; endMs?: number } | null {
  const normalized = wordArabic.replace(/[\u064B-\u065F]/g, "").trim();
  
  for (const line of lines) {
    const lineNormalized = line.arabic.replace(/[\u064B-\u065F]/g, "");
    if (lineNormalized.includes(normalized)) {
      return {
        sentenceText: line.arabic,
        sentenceEnglish: line.translation,
        startMs: line.startMs,
        endMs: line.endMs,
      };
    }
  }
  
  return null;
}
