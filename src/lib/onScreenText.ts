// What a video shows on screen, for display — separate from what it says.
//
// The pipeline stores overlays in `discover_videos.visual_timeline`. Videos
// analysed before that column existed have theirs appended to
// `transcript_lines` instead, tagged `source: "on_screen"`, which is exactly
// what made a caption read as a line of speech. Both are read here, the column
// first, so one component can render either without knowing which it got.
import {
  parseVisualTimeline,
  type VisualMoment,
} from "../../supabase/functions/_shared/visualTimelineCore";
import { isOnScreenLine } from "../../supabase/functions/_shared/onScreenText";
import type { WordToken } from "@/types/transcript";

/** One overlay, ready to render. */
export type ScreenTextLine = {
  id: string;
  text: string;
  translation?: string;
  startSeconds?: number;
  endSeconds?: number;
  confidence?: "high" | "medium" | "low";
  /**
   * `text` split into tappable words, the same shape a transcript line's
   * tokens take. Overlays carry no per-word gloss from the vision pass — a
   * caption is read as a picture, not parsed — so these have a `surface` only
   * and pick up their gloss the same way a transcript word with no gloss
   * does: on tap, from `translate-phrase`.
   */
  tokens: WordToken[];
};

/** Split an overlay's text into tappable words. */
function tokenize(text: string, lineId: string): WordToken[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((surface, index) => ({ id: `${lineId}-tok-${index}`, surface }));
}

/**
 * Split a stored transcript into what was said and what was merely shown.
 *
 * Every consumer of `transcript_lines` — line-by-line playback, shadowing,
 * vocabulary mining, the tutor's "what was said" context — wants the spoken
 * half only.
 */
export function splitTranscriptLines<T>(lines: T[] | null | undefined): {
  spoken: T[];
  onScreen: T[];
} {
  if (!Array.isArray(lines)) return { spoken: [], onScreen: [] };
  const spoken: T[] = [];
  const onScreen: T[] = [];
  for (const line of lines) (isOnScreenLine(line) ? onScreen : spoken).push(line);
  return { spoken, onScreen };
}

function fromMoments(moments: VisualMoment[]): ScreenTextLine[] {
  return moments
    .filter((moment) => Boolean(moment.text))
    .map((moment, index) => {
      const id = `screen-${index}-${moment.startSeconds}`;
      return {
        id,
        text: moment.text!,
        translation: moment.translation,
        startSeconds: moment.startSeconds,
        endSeconds: moment.endSeconds,
        confidence: moment.confidence,
        tokens: tokenize(moment.text!, id),
      };
    });
}

function fromLegacyLines(lines: unknown): ScreenTextLine[] {
  if (!Array.isArray(lines)) return [];
  return lines.filter(isOnScreenLine).map((line, index) => {
    const row = line as Record<string, unknown>;
    const startMs = typeof row.startMs === "number" ? row.startMs : undefined;
    const endMs = typeof row.endMs === "number" ? row.endMs : undefined;
    const id = typeof row.id === "string" ? row.id : `legacy-screen-${index}`;
    const text = String(row.arabic ?? "").trim();
    return {
      id,
      text,
      translation: typeof row.translation === "string" && row.translation.trim()
        ? row.translation.trim()
        : undefined,
      startSeconds: startMs === undefined ? undefined : startMs / 1000,
      endSeconds: endMs === undefined ? undefined : endMs / 1000,
      confidence: row.needs_review ? ("low" as const) : undefined,
      tokens: tokenize(text, id),
    };
  }).filter((line) => line.text.length > 0);
}

/**
 * Every overlay this video has, newest storage first.
 *
 * The legacy transcript is only consulted when the timeline is empty: once a
 * video has been through the current pipeline the column is authoritative, and
 * reading both would show the same caption twice.
 */
export function screenTextFor(
  video: { visual_timeline?: unknown; transcript_lines?: unknown } | null | undefined,
): ScreenTextLine[] {
  if (!video) return [];
  const fromTimeline = fromMoments(parseVisualTimeline(video.visual_timeline));
  if (fromTimeline.length > 0) return fromTimeline;
  return fromLegacyLines(video.transcript_lines);
}
