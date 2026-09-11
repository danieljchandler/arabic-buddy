import { describe, expect, it } from "vitest";
import {
  LiveTranscriptGrouper,
  type LiveGroupingEvent,
  type LiveSegment,
} from "./liveTranscriptGrouping";

/**
 * Turn reconstruction for GPT-Live, which marks no turn boundaries of its own.
 *
 * This is the only thing standing between the live call and a transcript that
 * never settles. `finalizeTurn` — the drift check, the mistake drill, the
 * finished-turn callback the UI renders — fires on a *closed* segment, so a
 * segment that never closes is a turn that never happened as far as the rest of
 * the app is concerned, and one that closes twice is a duplicate drill.
 */

/** Every `closed` segment, in the order the grouper emitted them. */
function closed(events: LiveGroupingEvent[]): LiveSegment[] {
  return events.filter((e) => e.type === "closed").map((e) => e.segment);
}

/** The latest `updated` snapshot, which is what the UI would be showing. */
function latest(events: LiveGroupingEvent[]): LiveSegment | undefined {
  const updates = events.filter((e) => e.type === "updated");
  return updates.at(-1)?.segment;
}

describe("accumulating one speaker's deltas", () => {
  it("concatenates fragments into a single growing segment", () => {
    const grouper = new LiveTranscriptGrouper();
    const events = [
      ...grouper.push({ speaker: "user", text: "أنا ", startMs: 0, endMs: 300 }, 0),
      ...grouper.push({ speaker: "user", text: "أبغى ", startMs: 300, endMs: 600 }, 100),
      ...grouper.push({ speaker: "user", text: "قهوة", startMs: 600, endMs: 900 }, 200),
    ];

    // One turn, not three. GPT-Live streams a spoken sentence as many deltas.
    expect(latest(events)?.text).toBe("أنا أبغى قهوة");
    expect(closed(events)).toEqual([]);
  });

  it("spans the whole utterance rather than the newest fragment", () => {
    const grouper = new LiveTranscriptGrouper();
    grouper.push({ speaker: "user", text: "a", startMs: 100, endMs: 200 }, 0);
    const events = grouper.push({ speaker: "user", text: "b", startMs: 200, endMs: 500 }, 10);

    expect(latest(events)).toMatchObject({ startMs: 100, endMs: 500 });
  });

  it("takes the union of the span when deltas arrive out of order", () => {
    const grouper = new LiveTranscriptGrouper();
    grouper.push({ speaker: "user", text: "b", startMs: 400, endMs: 800 }, 0);
    // Delivery order is not timeline order; the docs only promise the text
    // concatenates in delivery order.
    const events = grouper.push({ speaker: "user", text: "a", startMs: 100, endMs: 200 }, 10);

    expect(latest(events)).toMatchObject({ startMs: 100, endMs: 800 });
  });

  it("ignores an empty delta rather than treating it as speech", () => {
    const grouper = new LiveTranscriptGrouper();
    const events = grouper.push({ speaker: "user", text: "", startMs: 0, endMs: 0 }, 0);

    // An empty delta must not open a segment: a stray one between turns would
    // otherwise produce an empty turn in the transcript.
    expect(events).toEqual([]);
    expect(grouper.openSpeaker).toBeUndefined();
  });

  it("does not let an empty delta hold a finished turn open", () => {
    const grouper = new LiveTranscriptGrouper({ silenceMs: 1000 });
    grouper.push({ speaker: "user", text: "خلاص", startMs: 0, endMs: 400 }, 0);
    grouper.push({ speaker: "user", text: "", startMs: 400, endMs: 400 }, 900);

    // If the empty delta had counted as activity, this would still be inside
    // the silence window and the turn would hang.
    expect(closed(grouper.advance(1100))).toHaveLength(1);
  });
});

describe("closing a turn", () => {
  it("closes the open segment when the other speaker starts", () => {
    const grouper = new LiveTranscriptGrouper();
    grouper.push({ speaker: "user", text: "شلونك", startMs: 0, endMs: 500 }, 0);
    const events = grouper.push({ speaker: "assistant", text: "زين", startMs: 600, endMs: 900 }, 100);

    const done = closed(events);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ speaker: "user", text: "شلونك" });
    // The replacement is reported in the same batch, after the close, so a
    // caller applying them in order never shows two open turns at once.
    expect(latest(events)).toMatchObject({ speaker: "assistant", text: "زين" });
  });

  it("closes on silence when no one speaks next", () => {
    const grouper = new LiveTranscriptGrouper({ silenceMs: 2000 });
    grouper.push({ speaker: "user", text: "تمام", startMs: 0, endMs: 400 }, 1000);

    // Still inside the window: a learner pausing mid-sentence has not finished.
    expect(grouper.advance(2500)).toEqual([]);

    const done = closed(grouper.advance(3000));
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ text: "تمام" });
  });

  it("restarts the silence window every time the segment grows", () => {
    const grouper = new LiveTranscriptGrouper({ silenceMs: 1000 });
    grouper.push({ speaker: "user", text: "أنا", startMs: 0, endMs: 300 }, 0);
    grouper.push({ speaker: "user", text: " أبغى", startMs: 300, endMs: 600 }, 800);

    // 900ms after the *first* delta but only 100ms after the second, so the
    // learner is still talking. Measuring from the segment's start instead
    // would cut every sentence longer than the window in half.
    expect(grouper.advance(900)).toEqual([]);
    expect(closed(grouper.advance(1900))).toHaveLength(1);
  });

  it("closes a turn exactly once", () => {
    const grouper = new LiveTranscriptGrouper({ silenceMs: 500 });
    grouper.push({ speaker: "user", text: "أيوه", startMs: 0, endMs: 200 }, 0);

    expect(closed(grouper.advance(1000))).toHaveLength(1);
    // A second tick must not re-close it — that would drill the same mistake
    // twice and duplicate the turn in the transcript.
    expect(grouper.advance(2000)).toEqual([]);
    expect(grouper.close()).toEqual([]);
  });

  it("reports why a segment closed", () => {
    const grouper = new LiveTranscriptGrouper({ silenceMs: 500 });
    grouper.push({ speaker: "user", text: "one", startMs: 0, endMs: 100 }, 0);
    const bySpeaker = grouper.push({ speaker: "assistant", text: "two", startMs: 100, endMs: 200 }, 10);
    expect(bySpeaker.find((e) => e.type === "closed")).toMatchObject({ reason: "speaker_change" });

    const bySilence = grouper.advance(1000);
    expect(bySilence[0]).toMatchObject({ reason: "inactivity" });
  });

  it("gives each turn its own id, and reuses none", () => {
    const grouper = new LiveTranscriptGrouper();
    grouper.push({ speaker: "user", text: "a", startMs: 0, endMs: 10 }, 0);
    grouper.push({ speaker: "assistant", text: "b", startMs: 10, endMs: 20 }, 1);
    const third = grouper.push({ speaker: "user", text: "c", startMs: 20, endMs: 30 }, 2);

    // Turns are keyed on this id in the transcript state, so a repeat would
    // overwrite an earlier turn instead of appending a new one.
    expect(latest(third)?.id).toBe("live-3");
  });
});

describe("teardown", () => {
  it("flushes the turn that was still open", () => {
    const grouper = new LiveTranscriptGrouper();
    grouper.push({ speaker: "user", text: "آخر كلمة", startMs: 0, endMs: 500 }, 0);

    // The learner's last utterance before hanging up. Nothing else will close
    // it — there is no end-of-turn event and no further tick.
    const done = closed(grouper.close());
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ speaker: "user", text: "آخر كلمة" });
  });

  it("names the reason so a flush is distinguishable from a real ending", () => {
    const grouper = new LiveTranscriptGrouper();
    grouper.push({ speaker: "assistant", text: "مع السلامة", startMs: 0, endMs: 500 }, 0);

    expect(grouper.close()[0]).toMatchObject({ reason: "session_closed" });
  });

  it("is harmless when nothing is open", () => {
    expect(new LiveTranscriptGrouper().close()).toEqual([]);
  });
});

describe("what it deliberately does not do", () => {
  it("keeps a learner's one-word answer instead of suppressing it as a backchannel", () => {
    const grouper = new LiveTranscriptGrouper();
    // The SDK's own grouper drops short isolated utterances as backchannels.
    // Here "أيوه" is frequently the learner's entire answer, and it is exactly
    // what the mistake extractor is looking at — so it has to survive.
    grouper.push({ speaker: "assistant", text: "تحب قهوة؟", startMs: 0, endMs: 900 }, 0);
    const events = grouper.push({ speaker: "user", text: "أيوه", startMs: 1000, endMs: 1300 }, 100);

    expect(latest(events)).toMatchObject({ speaker: "user", text: "أيوه" });
    expect(closed(grouper.close())[0]).toMatchObject({ text: "أيوه" });
  });
});
