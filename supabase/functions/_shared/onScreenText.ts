// Text burned into a video's frames — POV captions, title cards, subtitles,
// stickers — and the rules that keep it out of the spoken transcript.
//
// A meme's joke is usually written on screen rather than said aloud, so the
// pipeline has always read those overlays. What it used to do with them was
// append them to `transcript_lines` as extra lines, which made every consumer
// of a transcript (line-by-line playback, shadowing, vocabulary mining, the
// tutor's "what was said" context) treat a caption as speech. Screen text is a
// different kind of evidence and now lives in its own column, `visual_timeline`.

/** One overlay as the vision pass reports it. */
export interface OnScreenSegment {
  text: string;
  translation?: string;
  transliteration?: string;
  startSeconds: number;
  endSeconds: number;
  confidence: "high" | "medium" | "low";
}

/** The `<id>.visual.json` blob staged beside a video's audio. */
export interface VisualResultBlob {
  onScreenTextSegments?: unknown;
  sceneContext?: unknown;
  culturalContext?: unknown;
  detectedDialectCues?: unknown;
}

const CONFIDENCES = ["high", "medium", "low"] as const;

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Coerce whatever the vision model returned into segments we can store.
 *
 * Tolerant on purpose: this is model output, and a run that returns eight good
 * overlays and one malformed entry should keep the eight. Anything with no text
 * is dropped — an overlay with no text is not an overlay.
 */
export function normalizeOnScreenSegments(
  raw: unknown,
  fallbackEndSeconds = 0,
): OnScreenSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: OnScreenSegment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const text = trimmed(row.text);
    if (!text) continue;
    const startSeconds = Math.max(0, numberOr(row.startSeconds ?? row.start_seconds, 0));
    const endRaw = row.endSeconds ?? row.end_seconds;
    const endSeconds = Math.max(
      startSeconds,
      numberOr(endRaw, Math.max(startSeconds, fallbackEndSeconds)),
    );
    const confidence = CONFIDENCES.includes(row.confidence as typeof CONFIDENCES[number])
      ? (row.confidence as OnScreenSegment["confidence"])
      : "medium";
    const translation = trimmed(row.translation);
    const transliteration = trimmed(row.transliteration);
    out.push({
      text,
      ...(translation ? { translation } : {}),
      ...(transliteration ? { transliteration } : {}),
      startSeconds,
      endSeconds,
      confidence,
    });
  }
  return out.sort((a, b) => a.startSeconds - b.startSeconds);
}

/** Read the segments out of a stored `<id>.visual.json` blob. */
export function segmentsFromVisualBlob(blob: VisualResultBlob | null | undefined): OnScreenSegment[] {
  if (!blob) return [];
  return normalizeOnScreenSegments(blob.onScreenTextSegments);
}

/**
 * The `visual_timeline` rows for a set of segments.
 *
 * The scene description rides on the first moment because the vision pass
 * describes the video as a whole, not one frame at a time.
 */
export function toVisualTimeline(
  segments: OnScreenSegment[],
  sceneContext?: string | null,
): Array<Record<string, unknown>> {
  const scene = trimmed(sceneContext);
  return segments.map((segment, index) => ({
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
    text: segment.text,
    ...(segment.translation ? { translation: segment.translation } : {}),
    confidence: segment.confidence,
    ...(index === 0 && scene ? { scene } : {}),
  }));
}

/**
 * Was this transcript line an overlay the old pipeline appended?
 *
 * Two markers, because two code paths wrote them: `source: "on_screen"` from
 * the pipeline's own merge step, and `segmentType: "text_overlay"` from the
 * analyzer. Rows written before this change still carry them.
 */
export function isOnScreenLine(line: unknown): boolean {
  if (!line || typeof line !== "object") return false;
  const row = line as Record<string, unknown>;
  return row.source === "on_screen" || row.segmentType === "text_overlay";
}

/** A transcript with every appended overlay line removed. */
export function stripOnScreenLines<T>(lines: T[] | null | undefined): T[] {
  if (!Array.isArray(lines)) return [];
  return lines.filter((line) => !isOnScreenLine(line));
}

/** Overlay lines recovered from a legacy transcript, as segments. */
export function segmentsFromLegacyLines(lines: unknown): OnScreenSegment[] {
  if (!Array.isArray(lines)) return [];
  return normalizeOnScreenSegments(
    lines.filter(isOnScreenLine).map((line) => {
      const row = line as Record<string, unknown>;
      const startMs = numberOr(row.startMs, 0);
      const endMs = numberOr(row.endMs, startMs);
      return {
        text: row.arabic,
        translation: row.translation,
        startSeconds: startMs / 1000,
        endSeconds: endMs / 1000,
        confidence: row.needs_review ? "low" : "medium",
      };
    }),
  );
}

/** `[0s-3s] النص — the text`, one overlay per line. */
export function summarizeOnScreenText(segments: OnScreenSegment[]): string {
  return segments
    .map((s) => `[${s.startSeconds}s-${s.endSeconds}s] ${s.text}${s.translation ? ` — ${s.translation}` : ""}`)
    .join("\n");
}

/** The prose blob the tutor and the analyzer read as background. */
export function buildVisualContextText(
  segments: OnScreenSegment[],
  sceneContext?: string | null,
  culturalContext?: string | null,
): string | null {
  const summary = summarizeOnScreenText(segments);
  return [
    summary ? `On-screen text:\n${summary}` : "",
    trimmed(sceneContext) ? `Scene: ${trimmed(sceneContext)}` : "",
    trimmed(culturalContext) ? `Cultural context: ${trimmed(culturalContext)}` : "",
  ].filter(Boolean).join("\n\n") || null;
}

/**
 * The OCR instruction shared by every pass that reads a video's screen —
 * the frame-sampling one the browser drives, and the whole-video re-read.
 *
 * Kept in one place because the two used to drift: a re-read that asks for a
 * different shape than the original produces a `visual_timeline` whose rows
 * disagree with the ones beside them.
 */
export const ON_SCREEN_TEXT_PROMPT =
  `You are reading the text burned into an Arabic social-media video (TikTok, Instagram, YouTube Shorts) so a learner can study it separately from the spoken audio.

Output ONLY valid JSON matching this schema:
{
  "onScreenTextSegments": [
    {
      "text": "exact text visible on screen (Arabic or Latin)",
      "translation": "English translation",
      "transliteration": "romanized pronunciation (Arabic only, omit for Latin text)",
      "startSeconds": 0.0,
      "endSeconds": 5.0,
      "confidence": "high"
    }
  ],
  "sceneContext": "1-2 sentence description of the setting and what is happening",
  "culturalContext": "Cultural notes relevant to understanding this content (empty string if nothing notable)",
  "detectedDialectCues": ["visual cues that suggest a specific Gulf country or dialect"]
}

Rules for onScreenTextSegments:
- Include ALL text overlays: POV captions (e.g. "POV: طالب في الجامعة"), subtitles, title cards, stickers, lower thirds, graphics
- "POV:" text is extremely common on TikTok/Instagram — always capture it
- Include BOTH Arabic-script text AND Latin-script text (English, romanized Arabic, etc.)
- Read the text EXACTLY as written, including emoji-adjacent words, line breaks (join with a space) and dialectal spelling. Do not translate into the text field and do not correct it toward Modern Standard Arabic.
- A caption split across two lines of the same overlay is ONE segment, not two
- Only include text actually visible — do not infer or guess
- If you are unsure about a word, include the visible characters with confidence "low" rather than omitting the whole overlay
- Estimate timestamps from when the text is on screen
- confidence: "high" if text is clear and readable, "medium" if partially visible, "low" if uncertain
- If the same text stays on screen across a stretch of the video, use a single segment with a broader time range
- Exclude platform UI (like/share/follow buttons, app chrome, the username watermark, the "add comment" bar) and hashtag/caption text that belongs to the post rather than the frame
- Never repeat the same overlay twice

For sceneContext: describe ONLY what is visibly present: location, number of people, activity, formal/informal tone. Do not infer relationships, dialogue, country, or the joke.
For culturalContext: explain only directly visible cultural signals or the literal role of the on-screen text. If the image alone is insufficient, use an empty string instead of guessing.
For detectedDialectCues: national flags, license plates, TV channel logos, brand signs, architecture, clothing patterns, or any geographic markers suggesting a specific Gulf country.

No additional text outside JSON.`;
