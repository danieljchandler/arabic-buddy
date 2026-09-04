import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { usePipelineResume } from "./usePipelineResume";

/**
 * The page-side half of pipeline recovery: a mid-run row that has stopped
 * moving gets one `{ videoId, resume: true }` per cooldown, a live one gets
 * nothing, and a person who cannot run the pipeline never asks.
 */

const NOW = Date.parse("2026-09-04T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
});

function renderResume(videos: Parameters<typeof usePipelineResume>[0], enabled = true) {
  const rendered = renderHookWithProviders(
    ({ list }: { list: typeof videos }) => usePipelineResume(list, { enabled }),
    { persona: "admin", initialProps: { list: videos } },
  );
  cleanups.push(rendered.cleanup);
  return rendered;
}

describe("usePipelineResume", () => {
  it("asks the pipeline to resume a run that has gone quiet", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const { backend } = renderResume([
      { id: "stalled", transcription_status: "processing", updated_at: ago(5 * 60 * 1000) },
    ]);

    await waitFor(() => expect(backend.callsTo("process-approved-video")).toHaveLength(1));
    expect(backend.lastCallTo("process-approved-video")?.body).toEqual({ videoId: "stalled", resume: true });
  });

  it("leaves a run that is still moving alone", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const { backend } = renderResume([
      { id: "alive", transcription_status: "processing", updated_at: ago(15 * 1000) },
      { id: "done", transcription_status: "completed", updated_at: ago(60 * 60 * 1000) },
    ]);

    // Give any stray invoke a tick to land before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.callsTo("process-approved-video")).toHaveLength(0);
  });

  it("nudges each video once per cooldown, however often the poll re-renders", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const stalled = { id: "stalled", transcription_status: "processing", updated_at: ago(5 * 60 * 1000) };
    const { backend, rerender } = renderResume([stalled]);
    await waitFor(() => expect(backend.callsTo("process-approved-video")).toHaveLength(1));

    // A refetch hands the effect a new array of the same row.
    rerender({ list: [{ ...stalled }] });
    rerender({ list: [{ ...stalled }] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.callsTo("process-approved-video")).toHaveLength(1);

    // Past the cooldown, with the row still not moving, it asks again.
    vi.setSystemTime(NOW + 4 * 60 * 1000);
    rerender({ list: [{ ...stalled }] });
    await waitFor(() => expect(backend.callsTo("process-approved-video")).toHaveLength(2));
  });

  it("does nothing when disabled", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const { backend } = renderResume(
      [{ id: "stalled", transcription_status: "processing", updated_at: ago(5 * 60 * 1000) }],
      false,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.callsTo("process-approved-video")).toHaveLength(0);
  });
});
