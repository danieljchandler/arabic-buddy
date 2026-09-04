import { describe, expect, it } from "vitest";
import {
  GIVE_UP_AFTER_MS,
  NUDGE_COOLDOWN_MS,
  STALE_AFTER_MS,
  shouldResumePipeline,
} from "./pipelineResume";

/**
 * The decision behind the admin pages' "this run has stopped moving" nudge.
 *
 * A false positive here starts a second paid run on top of a live one; a
 * false negative leaves a dead run for the reaper to fail twelve minutes
 * later. Both directions get a test.
 */

const NOW = Date.parse("2026-09-04T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("shouldResumePipeline", () => {
  it("nudges a processing row that has gone quiet", () => {
    const video = { id: "v", transcription_status: "processing", updated_at: ago(STALE_AFTER_MS.processing + 1000) };
    expect(shouldResumePipeline(video, NOW, null)).toBe(true);
  });

  it("leaves a processing row alone while it is still being touched", () => {
    // Every stage writes the row and the analysis wait heartbeats it, so a
    // recent updated_at means a worker is alive — even if the page has been
    // watching for ten minutes.
    const video = { id: "v", transcription_status: "processing", updated_at: ago(20 * 1000) };
    expect(shouldResumePipeline(video, NOW, null)).toBe(false);
  });

  it("picks up an analysis nobody finalised", () => {
    const video = { id: "v", transcription_status: "analysis_complete", updated_at: ago(60 * 1000) };
    expect(shouldResumePipeline(video, NOW, null)).toBe(true);
  });

  it("gives a fresh analysis_complete row a moment to be picked up", () => {
    const video = { id: "v", transcription_status: "analysis_complete", updated_at: ago(5 * 1000) };
    expect(shouldResumePipeline(video, NOW, null)).toBe(false);
  });

  it("is patient with a pending row, which the upload form holds while it works", () => {
    // Extracting, uploading and reading the frames of a big file can take
    // minutes with the row on pending the whole time. A nudge then would run
    // the engines on audio that is not there yet.
    const early = { id: "v", transcription_status: "pending", updated_at: ago(3 * 60 * 1000) };
    expect(shouldResumePipeline(early, NOW, null)).toBe(false);

    const lost = { id: "v", transcription_status: "pending", updated_at: ago(STALE_AFTER_MS.pending + 1000) };
    expect(shouldResumePipeline(lost, NOW, null)).toBe(true);
  });

  it("never nudges a finished, failed or manual row", () => {
    for (const status of ["completed", "failed", "manual", undefined, null]) {
      const video = { id: "v", transcription_status: status, updated_at: ago(60 * 60 * 1000) };
      expect(shouldResumePipeline(video, NOW, null)).toBe(false);
    }
  });

  it("waits out the cooldown after a nudge", () => {
    const video = { id: "v", transcription_status: "processing", updated_at: ago(10 * 60 * 1000) };
    expect(shouldResumePipeline(video, NOW, NOW - NUDGE_COOLDOWN_MS + 1000)).toBe(false);
    expect(shouldResumePipeline(video, NOW, NOW - NUDGE_COOLDOWN_MS - 1000)).toBe(true);
  });

  it("does not resurrect a row that has sat for a day", () => {
    const video = { id: "v", transcription_status: "processing", updated_at: ago(GIVE_UP_AFTER_MS + 60_000) };
    expect(shouldResumePipeline(video, NOW, null)).toBe(false);
  });

  it("does nothing for a row with no usable timestamp", () => {
    expect(shouldResumePipeline({ id: "v", transcription_status: "processing", updated_at: null }, NOW, null)).toBe(false);
    expect(shouldResumePipeline({ id: "v", transcription_status: "processing", updated_at: "not a date" }, NOW, null)).toBe(false);
  });
});
