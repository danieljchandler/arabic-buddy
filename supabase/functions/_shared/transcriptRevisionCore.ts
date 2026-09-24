// Pure half of the native-speaker review audit trail: given the lines a video
// had and the lines a reviewer is saving, describe every change as a row for
// `transcript_line_revisions`. No Deno globals, so the Vitest suite covers it
// (src/test/transcriptRevisionCore.test.ts); the IO lives in
// supabase/functions/transcript-review.
//
// This is a near neighbour of `transcriptDiffCore.ts` and deliberately not the
// same function. That one builds training pairs, so it is right for it to be
// conservative: it drops splits, merges and deletions, because a wrong pair is
// worse training data than no pair. An audit trail has the opposite duty. The
// reviewer needs to see what happened to a line even when what happened was
// that it stopped existing, and "the log is silent about the edits it wasn't
// sure how to describe" is the one thing a log may not be.

export type RevisionField =
  | "arabic"
  | "translation"
  | "literal"
  | "timing"
  | "structure"
  | "cultural_context"
  | "grammar_points"
  | "vocabulary"
  // The dialect classification a native reviewer sets: the country label, the
  // sub-variety under it, and the features they listed as marking it. Logged
  // like any other note, because re-labelling a video from Najdi to Hijazi
  // changes what every generator downstream thinks the clip is.
  | "dialect"
  | "dialect_subvariety"
  | "dialect_features"
  // The video's own name, in English and in Arabic. It is the one field a
  // learner sees before they have watched anything, and the pipeline guesses it
  // off the transcript — so it is wrong in exactly the way the reviewer is
  // there to catch, and it is a label rather than a publishing decision.
  | "title"
  | "title_arabic";

export type RevisionSource = "human" | "ai_retranslate" | "ai_resegment" | "resync";

export interface TranscriptRevision {
  /** Null for a change to the video rather than to one of its lines. */
  lineId: string | null;
  field: RevisionField;
  previousValue: string | null;
  newValue: string | null;
}

export interface RevisionLineLike {
  id?: unknown;
  arabic?: unknown;
  translation?: unknown;
  literal?: unknown;
  startMs?: unknown;
  endMs?: unknown;
}

/**
 * More revisions than this in one save is a regeneration, not an edit session.
 *
 * The same reasoning as `MAX_PAIRS_PER_SAVE`, and the same number: re-running
 * the analysis pipeline rewrites every line, and logging four thousand rows
 * describing "the machine replaced everything" buries the twelve rows where a
 * person actually decided something.
 */
export const MAX_REVISIONS_PER_SAVE = 200;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;

/** Whitespace-insensitive equality — reflowing a line is not a correction. */
function sameText(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ") === b.replace(/\s+/g, " ");
}

function idOf(line: RevisionLineLike): string | null {
  const id = str(line.id);
  return id || null;
}

/**
 * A line's span as a human-readable string.
 *
 * Timings are stored as milliseconds but read by people, and a reviewer
 * comparing "12300" against "12800" has to do arithmetic to see that the change
 * was half a second. Seconds to two places is how every other timestamp in the
 * editor is shown.
 */
export function formatTiming(startMs: unknown, endMs: unknown): string | null {
  const start = num(startMs);
  const end = num(endMs);
  if (start === null && end === null) return null;
  const fmt = (ms: number | null) => (ms === null ? "?" : `${(ms / 1000).toFixed(2)}s`);
  return `${fmt(start)} → ${fmt(end)}`;
}

/** Longer than this and the log entry is an essay, not a diff. */
const MAX_VALUE_LENGTH = 4000;

function clip(value: string | null): string | null {
  if (value === null) return null;
  return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
}

/**
 * Diff stored lines against the lines being saved.
 *
 * Lines are paired by id. Unlike the training-pair diff there is no fallback to
 * start time: a reviewer who drags a boundary changes the start time of a line
 * that is otherwise untouched, and pairing on it would report that as a
 * different line rather than as a retimed one.
 *
 * A line whose id is gone from the new list is reported as a removal, and an id
 * that wasn't in the old list as an addition. Between them those two cover
 * splits, merges and deletions — the operations the training diff skips —
 * because that is exactly how the editor represents them: `mergeSegments` keeps
 * the left line's id and drops the right one's, and `splitSegment` keeps the
 * left half's id and mints a new one for the right.
 */
export function diffTranscriptRevisions(
  oldLines: unknown,
  newLines: unknown,
  maxRevisions: number = MAX_REVISIONS_PER_SAVE,
): TranscriptRevision[] {
  if (!Array.isArray(oldLines) || !Array.isArray(newLines)) return [];

  const oldById = new Map<string, RevisionLineLike>();
  for (const raw of oldLines) {
    const line = raw as RevisionLineLike;
    const id = idOf(line);
    // First occurrence wins: a duplicate id means identity is unreliable here,
    // and diffing against the wrong twin invents a change nobody made.
    if (id && !oldById.has(id)) oldById.set(id, line);
  }

  const revisions: TranscriptRevision[] = [];
  const seen = new Set<string>();
  const room = () => revisions.length < maxRevisions;

  for (const raw of newLines) {
    if (!room()) return revisions;
    const line = raw as RevisionLineLike;
    const id = idOf(line);
    if (!id) continue;
    seen.add(id);

    const prior = oldById.get(id);

    if (!prior) {
      revisions.push({
        lineId: id,
        field: "structure",
        previousValue: null,
        newValue: clip(str(line.arabic)) || null,
      });
      continue;
    }

    for (const field of ["arabic", "translation", "literal"] as const) {
      if (!room()) return revisions;
      const before = str(prior[field]);
      const after = str(line[field]);
      // An empty-to-empty pair is not a change, and neither is reflowing.
      if (before === after || sameText(before, after)) continue;
      revisions.push({
        lineId: id,
        field,
        previousValue: clip(before) || null,
        newValue: clip(after) || null,
      });
    }

    if (!room()) return revisions;
    const beforeTiming = formatTiming(prior.startMs, prior.endMs);
    const afterTiming = formatTiming(line.startMs, line.endMs);
    if (beforeTiming !== afterTiming && (beforeTiming || afterTiming)) {
      revisions.push({
        lineId: id,
        field: "timing",
        previousValue: beforeTiming,
        newValue: afterTiming,
      });
    }
  }

  for (const [id, line] of oldById) {
    if (!room()) return revisions;
    if (seen.has(id)) continue;
    revisions.push({
      lineId: id,
      field: "structure",
      previousValue: clip(str(line.arabic)) || null,
      newValue: null,
    });
  }

  return revisions;
}

/**
 * Describe a change to one of the video's own fields.
 *
 * Grammar points, vocabulary and dialect features are arrays of objects; they
 * are logged as pretty-printed JSON because there is no useful shorter
 * rendering of "the third example on the second grammar point changed", and the
 * diff view shows these side by side rather than inline.
 */
export function diffVideoField(
  field: Extract<
    RevisionField,
    | "cultural_context"
    | "grammar_points"
    | "vocabulary"
    | "dialect"
    | "dialect_subvariety"
    | "dialect_features"
    | "title"
    | "title_arabic"
  >,
  previous: unknown,
  next: unknown,
): TranscriptRevision | null {
  const render = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v.trim();
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return "";
    }
  };

  const before = render(previous);
  const after = render(next);
  if (before === after) return null;

  return {
    lineId: null,
    field,
    previousValue: clip(before) || null,
    newValue: clip(after) || null,
  };
}

/**
 * The payload keys `save_notes` knows how to write, in the client's spelling.
 *
 * Echoed back by the function as `accepted` — the subset of these that were
 * present in the request — so the app can tell a field the server wrote (or
 * found unchanged) from one it never looked at.
 *
 * That distinction is the whole reason this list exists. Edge functions do not
 * deploy on merge, and a `transcript-review` older than the app answers a save
 * with `{ saved: true }` while ignoring any key it predates. That is how a
 * transcriber's corrected title came back "Notes saved" and was not saved: the
 * function serving it was from before titles were on the allow-list, so the
 * rename was dropped without a word and the Arabic notes beside it went through.
 */
export const SAVE_NOTES_FIELDS = [
  "title",
  "titleArabic",
  "dialect",
  "dialectSubvariety",
  "dialectFeatures",
  "culturalContext",
  "grammarPoints",
  "vocabulary",
] as const;

export type SaveNotesField = (typeof SAVE_NOTES_FIELDS)[number];

/** Which of `SAVE_NOTES_FIELDS` a request carried — what the server reports. */
export function acceptedNoteFields(body: Record<string, unknown>): SaveNotesField[] {
  return SAVE_NOTES_FIELDS.filter((field) => field in body);
}

/**
 * The fields a `save_notes` reply shows were dropped rather than handled.
 *
 * A reply with an `accepted` list is from a function that reports what it did,
 * so anything sent and not on it was ignored. A reply without one is from a
 * deployment older than that report — which is also older than the titles, so
 * those are the fields it is known to have dropped; everything else it handled
 * before the report existed.
 */
export function unappliedNoteFields(
  sent: readonly string[],
  reply: { accepted?: unknown } | null | undefined,
): string[] {
  const accepted = Array.isArray(reply?.accepted) ? (reply!.accepted as unknown[]) : null;
  if (accepted) return sent.filter((field) => !accepted.includes(field));
  return sent.filter((field) => field === "title" || field === "titleArabic");
}
