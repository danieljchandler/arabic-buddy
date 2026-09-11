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
// So turns are inferred here, and the shape of the inference is set by full
// duplex: **each speaker gets their own open segment, and only silence closes
// one.** A speaker change is not a turn boundary, because on this engine the two
// sides genuinely do talk at once.
//
// Treating a speaker change as a boundary — the obvious first design, and the
// one a half-duplex engine invites — breaks on the case GPT-Live exists to
// support. The tutor drops an "أيوه" to show it is listening (which this app's
// own voice prompt explicitly invites) while the learner is mid-sentence:
//
//   learner    أنا أبغى ...
//   assistant              أيوه
//   learner                     ... قهوة
//
// Closing on the speaker change finalizes "أنا أبغى" as if the learner had
// stopped there, makes "قهوة" a second turn, and hands the mistake extractor a
// fragment paired with a backchannel. One utterance, three turns, and the one
// piece of evidence about the learner's Arabic is now half a sentence.
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
// the SDK version does that matters for us: it keeps the two speakers' text
// apart without letting either one truncate the other.
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

export type LiveSegmentCloseReason = "inactivity" | "session_closed";

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
 * than emitting, so the caller stays in control of ordering. Both speakers can
 * hold an open segment at the same time — that is the point — and closes are
 * always reported in the order the segments began, so a caller applying them in
 * sequence sees turns finalize in the order they were spoken.
 */
export class LiveTranscriptGrouper {
  private readonly silenceMs: number;
  /** The open segment per speaker, with the caller's clock at its last growth. */
  private readonly open = new Map<LiveSpeaker, { segment: LiveSegment; lastActivityAt: number }>();
  private counter = 0;

  constructor(options: LiveGrouperOptions = {}) {
    this.silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS;
  }

  /** The speakers currently holding an open segment, in the order they began. */
  get openSpeakers(): LiveSpeaker[] {
    return [...this.open.entries()]
      .sort((a, b) => a[1].segment.startMs - b[1].segment.startMs)
      .map(([speaker]) => speaker);
  }

  /**
   * Take one transcript delta. `nowMs` is the caller's monotonic clock, used
   * only to decide inactivity later.
   */
  push(delta: LiveTranscriptDelta, nowMs: number): LiveGroupingEvent[] {
    // An empty delta is not speech: it must not open a segment, and it must not
    // count as activity that keeps a finished one alive.
    if (!delta.text) return [];

    const current = this.open.get(delta.speaker);
    let segment: LiveSegment;

    if (current) {
      segment = {
        ...current.segment,
        text: current.segment.text + delta.text,
        // Deltas can arrive out of order; the segment's span is the union of
        // what contributed to it, never just the newest fragment's end.
        startMs: Math.min(current.segment.startMs, delta.startMs),
        endMs: Math.max(current.segment.endMs, delta.endMs),
      };
    } else {
      this.counter += 1;
      segment = {
        id: `live-${this.counter}`,
        speaker: delta.speaker,
        text: delta.text,
        startMs: delta.startMs,
        endMs: delta.endMs,
      };
    }

    this.open.set(delta.speaker, { segment, lastActivityAt: nowMs });
    return [{ type: "updated", segment }];
  }

  /**
   * Close every segment that has been quiet for `silenceMs`.
   *
   * Call this on a timer. Since a speaker change no longer ends a turn, this is
   * the only thing that closes one mid-call — so without it running, nothing
   * ever reaches the mistake drill.
   */
  advance(nowMs: number): LiveGroupingEvent[] {
    const stale = [...this.open.entries()]
      .filter(([, held]) => nowMs - held.lastActivityAt >= this.silenceMs)
      .sort((a, b) => a[1].segment.startMs - b[1].segment.startMs)
      .map(([speaker]) => speaker);

    return stale.map((speaker) => this.closeSpeaker(speaker, "inactivity"));
  }

  /** Close whatever is still open at teardown. Idempotent. */
  close(): LiveGroupingEvent[] {
    return this.openSpeakers.map((speaker) => this.closeSpeaker(speaker, "session_closed"));
  }

  private closeSpeaker(speaker: LiveSpeaker, reason: LiveSegmentCloseReason): LiveGroupingEvent {
    const held = this.open.get(speaker) as { segment: LiveSegment };
    this.open.delete(speaker);
    return { type: "closed", segment: held.segment, reason };
  }
}
