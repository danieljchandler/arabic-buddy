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
