import type { TranscriptLine } from "@/types/transcript";

/**
 * Local, unpublished drafts of a video's transcript.
 *
 * Correcting a transcript is an hour of detailed work held in one page's React
 * state, and nothing left that state until somebody pressed Update Video. A
 * closed tab, a reload, a browser that ran out of memory on the audio, or a
 * refetch of the video row landing under the editor took the whole session with
 * it and left no trace that it had ever existed.
 *
 * So every settled edit is written here, on the reviewer's own device, keyed by
 * video. That is explicitly *not* publishing: nobody else can see a draft, the
 * learner-facing video still shows what was last published, and Update Video is
 * still the only thing that changes what is stored. The draft is a safety net
 * under the work in progress, and the banner over the editor says so, because
 * "auto-saved" reading as "live" would be a far worse failure than losing an
 * hour — it would mean shipping half-corrected Arabic to learners without
 * anyone deciding to.
 */
export interface TranscriptDraft {
  /** The video these lines belong to — re-checked on read, so a stale key can't cross videos. */
  videoId: string;
  /** Epoch milliseconds, for the "auto-saved at" the banner shows. */
  savedAt: number;
  lines: TranscriptLine[];
}

const KEY_PREFIX = "hakiya:transcript-draft:v1:";

/**
 * How long an unpublished draft is worth offering back.
 *
 * Long enough to survive a holiday, short enough that a draft nobody returned
 * to does not sit in front of a different reviewer months later claiming to be
 * newer than what is published.
 */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function draftKey(videoId: string): string {
  return `${KEY_PREFIX}${videoId}`;
}

/**
 * A stable string for a set of lines, with object keys sorted and `undefined`
 * dropped.
 *
 * Plain `JSON.stringify` would compare key order, which differs between a row
 * that came back from Postgres jsonb and the same row rebuilt by the editor —
 * so identical transcripts would read as changed, and the banner would claim
 * unpublished work on a page nobody had touched.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue;
      out[key] = canonical(entry);
    }
    return out;
  }
  return value;
}

/** The lines as one comparable string. Exported for the tests that pin the rules above. */
export function canonicalLines(lines: TranscriptLine[]): string {
  return JSON.stringify(canonical(lines));
}

/** Whether two transcripts hold the same content, whatever order their keys are in. */
export function linesEqual(a: TranscriptLine[], b: TranscriptLine[]): boolean {
  return canonicalLines(a) === canonicalLines(b);
}

/**
 * The draft stored for this video, or null.
 *
 * Anything unreadable, mis-keyed or past `DRAFT_MAX_AGE_MS` is discarded rather
 * than handed back: a draft is only useful if the reviewer can trust that it is
 * theirs and recent.
 */
export function readDraft(videoId: string, now: number = Date.now()): TranscriptDraft | null {
  if (typeof window === "undefined" || !videoId) return null;
  try {
    const raw = window.localStorage.getItem(draftKey(videoId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TranscriptDraft>;
    if (
      !parsed ||
      parsed.videoId !== videoId ||
      typeof parsed.savedAt !== "number" ||
      !Array.isArray(parsed.lines)
    ) {
      window.localStorage.removeItem(draftKey(videoId));
      return null;
    }
    if (now - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      window.localStorage.removeItem(draftKey(videoId));
      return null;
    }
    return { videoId, savedAt: parsed.savedAt, lines: parsed.lines as TranscriptLine[] };
  } catch {
    // Malformed JSON, or a browser that refuses storage entirely.
    return null;
  }
}

/**
 * Store a draft, returning what was stored — or null if the browser refused.
 *
 * A refusal is a real possibility here and not a theoretical one: transcripts
 * run to hundreds of lines with per-word tokens, and private-mode Safari and a
 * full quota both throw. The caller surfaces the null, because a safety net
 * nobody is told has failed is worse than no safety net at all.
 */
export function writeDraft(
  videoId: string,
  lines: TranscriptLine[],
  now: number = Date.now(),
): TranscriptDraft | null {
  if (typeof window === "undefined" || !videoId) return null;
  const draft: TranscriptDraft = { videoId, savedAt: now, lines };
  try {
    window.localStorage.setItem(draftKey(videoId), JSON.stringify(draft));
    return draft;
  } catch {
    return null;
  }
}

export function clearDraft(videoId: string): void {
  if (typeof window === "undefined" || !videoId) return;
  try {
    window.localStorage.removeItem(draftKey(videoId));
  } catch {
    /* nothing to clean up if the store was never reachable */
  }
}

/**
 * "14:32" — a wall-clock time rather than "3 minutes ago".
 *
 * The question a reviewer asks a recovered draft is "is this the work I
 * remember doing?", and a clock time answers it against their memory of the
 * afternoon. A relative age answers a question they weren't asking.
 */
export function formatDraftTime(savedAt: number): string {
  return new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
