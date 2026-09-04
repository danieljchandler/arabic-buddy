import { describe, expect, it } from "vitest";
import {
  QUIET_BEFORE_STALLED_MS,
  describePipelineProgress,
  describeQuietFor,
  readPipelineNote,
} from "./pipelineProgress";

/**
 * What the admin page can say about a run it cannot see.
 *
 * The point of every case here is that a spinner alone is not a report: the
 * step, the silence and the deployed build each rule out a different cause of
 * "it never finishes".
 */

const NOW = Date.parse("2026-09-04T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("readPipelineNote", () => {
  it("finds the note the pipeline wrote", () => {
    expect(readPipelineNote({ pipeline: { stage: "asr" }, asr: {} })).toEqual({ stage: "asr" });
  });

  it("says nothing for a row that predates progress reporting", () => {
    // engines_used has carried ASR and translation provenance for far longer
    // than it has carried a pipeline note; those rows must not read as broken.
    expect(readPipelineNote({ asr: { munsit: { ok: true } } })).toBeNull();
    expect(readPipelineNote(null)).toBeNull();
    expect(readPipelineNote("not an object")).toBeNull();
    expect(readPipelineNote({ pipeline: "not an object" })).toBeNull();
  });
});

describe("describePipelineProgress", () => {
  it("prefers the pipeline's own words to the stage name", () => {
    const progress = describePipelineProgress(
      { pipeline: { stage: "analyze", note: "waiting for the analysis (90s)", at: ago(10_000) } },
      NOW,
    );

    expect(progress?.step).toBe("waiting for the analysis (90s)");
    expect(progress?.looksStalled).toBe(false);
  });

  it("falls back to a readable label when only a stage was written", () => {
    const progress = describePipelineProgress({ pipeline: { stage: "asr", at: ago(1000) } }, NOW);
    expect(progress?.step).toBe("Transcribing the audio");
  });

  it("calls a run stalled once it has been quiet longer than a live one ever is", () => {
    // A live run writes at least every 30s, so this is the difference between
    // a slow step and a worker that is gone.
    const alive = describePipelineProgress({ pipeline: { stage: "asr", at: ago(20_000) } }, NOW);
    expect(alive?.looksStalled).toBe(false);

    const dead = describePipelineProgress(
      { pipeline: { stage: "asr", at: ago(QUIET_BEFORE_STALLED_MS + 1000) } },
      NOW,
    );
    expect(dead?.looksStalled).toBe(true);
    expect(dead?.quietForMs).toBe(QUIET_BEFORE_STALLED_MS + 1000);
  });

  it("reports the deployed build, which is what answers 'did the deploy land?'", () => {
    const progress = describePipelineProgress(
      { pipeline: { stage: "asr", build: "staged-2026-09-04", at: ago(1000) } },
      NOW,
    );
    expect(progress?.build).toBe("staged-2026-09-04");
  });

  it("shows when a stage had to run inline instead of as its own request", () => {
    // Running inline is the old, fragile shape. A run that does it every time
    // is a run whose stage boundaries are not working, which is worth seeing
    // rather than inferring from the symptoms.
    const degraded = describePipelineProgress(
      { pipeline: { stage: "analyze", hop: "inline: hop refused", at: ago(1000) } },
      NOW,
    );
    expect(degraded?.inline).toBe(true);

    const normal = describePipelineProgress({ pipeline: { stage: "analyze", hop: "-", at: ago(1000) } }, NOW);
    expect(normal?.inline).toBe(false);
  });

  it("copes with a note that has no usable timestamp", () => {
    const progress = describePipelineProgress({ pipeline: { stage: "asr", at: "not a date" } }, NOW);
    expect(progress?.quietForMs).toBeNull();
    expect(progress?.looksStalled).toBe(false);
  });

  it("says nothing at all when there is no note", () => {
    expect(describePipelineProgress({ asr: {} }, NOW)).toBeNull();
  });
});

describe("describeQuietFor", () => {
  it("reads as an admin would say it", () => {
    expect(describeQuietFor(5_000)).toBe("just now");
    expect(describeQuietFor(3 * 60_000)).toBe("3m ago");
    expect(describeQuietFor(2 * 60 * 60_000)).toBe("2h ago");
    expect(describeQuietFor(null)).toBeNull();
  });
});
