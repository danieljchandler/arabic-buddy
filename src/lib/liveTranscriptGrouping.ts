// liveTranscriptGrouping — turns GPT-Live's transcript deltas back into turns.
//
// The Realtime API marked its own turn boundaries: every transcript delta
// carried an `item_id`, and a matching `.done`/`.completed` event said the turn
// had finished. GPT-Live has neither. Its deltas carry only a speaker (which of
// the two event names delivered them), the text, and a `start_ms`/`end_ms`
// position on the session timeline — and the migration guide is explicit that
// "GPT-Live has no corresponding event marking the end of each spoken
// response". Full duplex is why: when both sides can talk at once there is no
// single moment that ends a turn.
//
// So turns are inferred here. Two rules close the open segment:
//
//   speaker change — the other side started talking, so this one is done.
//   inactivity     — nothing more arrived from this speaker for `silenceMs`.
//
// The app needs those boundaries for more than display: `finalizeTurn` is what
// feeds the learner-mistake extractor, so a turn that never closes is a mistake
// never recorded, and a turn that closes twice is a duplicate drill.
//
// Why not the SDK's own `TranscriptGrouper`: it suppresses short utterances as
// backchannels by default, which is right for a support agent and wrong here.
// "أيوه", "نعم", "تمام" from a learner are not noise to be filtered out of the
// transcript — they are often the entire answer, and they are exactly what the
// mistake extractor wants to see. This keeps every word and does the one thing
// the SDK version does that matters for us: it separates speakers.
//
// Timeline milliseconds order the transcript; they are not a clock. A gap in
// `end_ms` means the session was silent, but the events announcing it can
// arrive late or bunched, so inactivity is measured on the caller's own
// monotonic clock, passed in rather than read, which keeps this testable.

export type LiveSpeaker = "user" | "assistant";

export interface LiveTranscriptDelta {
  speaker: LiveSpeaker;
  text: string;
  /** Start of this fragment on the session timeline, in ms from session start. */
  startMs: number;
  /** End of the same fragment. Never earlier than `startMs`. */
  endMs: number;
}

export interface LiveSegment {
  /** Stable id for this segment, local to this grouper. Not a server turn id. */
  id: string;
  speaker: LiveSpeaker;
  /** Everything accumulated for this segment so far. */
  text: string;
  startMs: number;
  endMs: number;
}

export type LiveSegmentCloseReason = "speaker_change" | "inactivity" | "session_closed";

export type LiveGroupingEvent =
  | { type: "updated"; segment: LiveSegment }
  | { type: "closed"; segment: LiveSegment; reason: LiveSegmentCloseReason };

export interface LiveGrouperOptions {
  /**
   * How long one speaker's transcript may go quiet before the segment closes.
   *
   * 2s matches the SDK's own default. Shorter chops a learner's hesitation into
   * two turns, which is the common case here and the one worth protecting: the
   * pauses mid-sentence are longer than a fluent speaker's because the learner
   * is assembling the sentence.
   */
  silenceMs?: number;
}

const DEFAULT_SILENCE_MS = 2000;

/**
 * Accumulates Live transcript deltas and emits turn-shaped segments.
 *
 * One instance per call. Every method returns the events it produced rather
 * than emitting, so the caller stays in control of ordering — a `closed` always
 * precedes the `updated` for the segment that displaced it.
 */
export class LiveTranscriptGrouper {
  private readonly silenceMs: number;
  private open: LiveSegment | null = null;
  /** The caller's clock reading when the open segment last grew. */
  private lastActivityAt = 0;
  private counter = 0;

  constructor(options: LiveGrouperOptions = {}) {
    this.silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS;
  }

  /** The speaker currently holding an open segment, if any. */
  get openSpeaker(): LiveSpeaker | undefined {
    return this.open?.speaker;
  }

  /**
   * Take one transcript delta. `nowMs` is the caller's monotonic clock, used
   * only to decide inactivity later.
   */
  push(delta: LiveTranscriptDelta, nowMs: number): LiveGroupingEvent[] {
    const events: LiveGroupingEvent[] = [];

    // An empty delta is not speech: it must not reopen a closed segment, and
    // it must not count as activity that keeps a finished one alive.
    if (!delta.text) return events;

    if (this.open && this.open.speaker !== delta.speaker) {
      events.push(this.closeOpen("speaker_change"));
    }

    if (!this.open) {
      this.counter += 1;
      this.open = {
        id: `live-${this.counter}`,
        speaker: delta.speaker,
        text: delta.text,
        startMs: delta.startMs,
        endMs: delta.endMs,
      };
    } else {
      this.open = {
        ...this.open,
        text: this.open.text + delta.text,
        // Deltas can arrive out of order; the segment's span is the union of
        // what contributed to it, never just the newest fragment's end.
        startMs: Math.min(this.open.startMs, delta.startMs),
        endMs: Math.max(this.open.endMs, delta.endMs),
      };
    }

    this.lastActivityAt = nowMs;
    events.push({ type: "updated", segment: this.open });
    return events;
  }

  /**
   * Close the open segment if it has been quiet for `silenceMs`.
   *
   * Call this on a timer. It is the only thing that ends the last turn of a
   * one-sided stretch — a learner who says three sentences and then stops has
   * no speaker change to close them.
   */
  advance(nowMs: number): LiveGroupingEvent[] {
    if (!this.open) return [];
    if (nowMs - this.lastActivityAt < this.silenceMs) return [];
    return [this.closeOpen("inactivity")];
  }

  /** Close whatever is open at teardown. Idempotent. */
  close(): LiveGroupingEvent[] {
    if (!this.open) return [];
    return [this.closeOpen("session_closed")];
  }

  private closeOpen(reason: LiveSegmentCloseReason): LiveGroupingEvent {
    const segment = this.open as LiveSegment;
    this.open = null;
    return { type: "closed", segment, reason };
  }
}
