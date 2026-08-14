// What is on a video's screen, and when.
//
// `extract-visual-context` reads every text overlay in a video with its timing.
// That result used to be flattened into one prose blob, which told the tutor a
// video contains captions somewhere without ever saying which one is showing
// now. These are the shape and the lookup that keep the timing.
//
// Pure: the client resolves the current moment as playback advances, and the
// ingest side normalises what the vision model returned. Same rules both ends.

export interface VisualMoment {
  startSeconds: number;
  endSeconds?: number;
  /** Text burned into the frame — a caption, a POV line, a title card. */
  text?: string;
  translation?: string;
  /** What is visibly happening, when the extractor described it. */
  scene?: string;
  confidence?: "high" | "medium" | "low";
}

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const str = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Read a stored timeline. Tolerant by design: this is jsonb written by an
 * earlier version of a vision prompt, so anything unrecognisable is dropped
 * rather than trusted.
 */
export function parseVisualTimeline(raw: unknown): VisualMoment[] {
  if (!Array.isArray(raw)) return [];
  const out: VisualMoment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const startSeconds = num(row.startSeconds) ?? num(row.start_seconds);
    const text = str(row.text);
    const scene = str(row.scene);
    // A moment with no time is unplaceable, and one with nothing to say is
    // not a moment.
    if (startSeconds === undefined || (!text && !scene)) continue;
    const confidence = row.confidence;
    out.push({
      startSeconds,
      endSeconds: num(row.endSeconds) ?? num(row.end_seconds),
      text,
      translation: str(row.translation),
      scene,
      confidence:
        confidence === "high" || confidence === "medium" || confidence === "low"
          ? confidence
          : undefined,
    });
  }
  return out.sort((a, b) => a.startSeconds - b.startSeconds);
}

/**
 * How long past its start a moment with no end is still considered on screen.
 *
 * The vision model estimates timings from sampled frames and often omits the
 * end. Overlays are typically on screen for a few seconds, so a bounded window
 * beats both alternatives: treating it as instantaneous makes it invisible to
 * every lookup, and treating it as open-ended makes the first caption in a
 * video appear to be showing three minutes later.
 */
const OPEN_ENDED_WINDOW_SECONDS = 6;

/** Every moment on screen at a given point in the video. */
export function momentsAt(timeline: VisualMoment[], seconds: number): VisualMoment[] {
  if (!Number.isFinite(seconds)) return [];
  return timeline.filter((moment) => {
    if (seconds + 0.001 < moment.startSeconds) return false;
    const end = moment.endSeconds ?? moment.startSeconds + OPEN_ENDED_WINDOW_SECONDS;
    return seconds <= end + 0.001;
  });
}

/**
 * One line describing what the learner can see right now, or undefined when
 * nothing is on screen worth mentioning.
 *
 * Low-confidence readings are marked rather than dropped. The alternative is a
 * tutor that either states a half-legible caption as fact, or claims there is
 * no text on a screen that plainly has some.
 */
export function visualContextAt(raw: unknown, seconds: number | undefined): string | undefined {
  if (seconds === undefined) return undefined;
  const moments = momentsAt(parseVisualTimeline(raw), seconds);
  if (moments.length === 0) return undefined;

  const parts = moments.map((moment) => {
    const bits: string[] = [];
    if (moment.text) {
      const gloss = moment.translation ? ` (${moment.translation})` : "";
      const hedge = moment.confidence === "low" ? ", partly legible" : "";
      bits.push(`on-screen text "${moment.text}"${gloss}${hedge}`);
    }
    if (moment.scene) bits.push(moment.scene);
    return bits.join("; ");
  });
  return parts.filter(Boolean).join(" · ");
}
