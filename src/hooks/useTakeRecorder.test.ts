import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordingSupported, useTakeRecorder } from "./useTakeRecorder";

/**
 * One take from the microphone. The things that go wrong with recorders are
 * all about what is left behind: a track that keeps the recording light on, a
 * timer that stops a recorder that already stopped, a take that fires after
 * the card is gone. So the tests are mostly about stopping.
 */

interface FakeRecorder {
  state: string;
  stop: () => void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
}

let recorders: FakeRecorder[] = [];
let recordedBytes = 16;
let micThrows: Error | null = null;
const tracks: Array<{ stop: ReturnType<typeof vi.fn> }> = [];

const originals = {
  MediaRecorder: (globalThis as Record<string, unknown>).MediaRecorder,
  mediaDevices: Object.getOwnPropertyDescriptor(navigator, "mediaDevices"),
};

class FakeMediaRecorder {
  static isTypeSupported = () => true;
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    recorders.push(this as unknown as FakeRecorder);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(recordedBytes)]) });
    this.onstop?.();
  }
}

beforeEach(() => {
  recorders = [];
  tracks.length = 0;
  recordedBytes = 16;
  micThrows = null;
  (globalThis as Record<string, unknown>).MediaRecorder = FakeMediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        if (micThrows) throw micThrows;
        const track = { stop: vi.fn() };
        tracks.push(track);
        return { getTracks: () => [track] } as unknown as MediaStream;
      }),
    },
  });
});

afterEach(() => {
  (globalThis as Record<string, unknown>).MediaRecorder = originals.MediaRecorder;
  if (originals.mediaDevices) Object.defineProperty(navigator, "mediaDevices", originals.mediaDevices);
  vi.useRealTimers();
});

describe("support", () => {
  it("is supported with a microphone and a recorder", () => {
    expect(recordingSupported()).toBe(true);
  });

  it("is unsupported without MediaRecorder", () => {
    (globalThis as Record<string, unknown>).MediaRecorder = undefined;
    expect(recordingSupported()).toBe(false);
  });
});

describe("a take", () => {
  it("records, stops, releases the microphone and hands over the audio", async () => {
    const onTake = vi.fn();
    const { result } = renderHook(() => useTakeRecorder({ onTake }));

    await act(async () => {
      expect(await result.current.start()).toBe(true);
    });
    expect(result.current.isRecording).toBe(true);

    act(() => {
      result.current.stop();
    });

    expect(result.current.isRecording).toBe(false);
    expect(tracks[0].stop).toHaveBeenCalled();
    await waitFor(() => expect(onTake).toHaveBeenCalledTimes(1));
    expect(onTake.mock.calls[0][0]).toBeInstanceOf(Blob);
  });

  it("drops an empty take rather than scoring silence", async () => {
    recordedBytes = 0;
    const onTake = vi.fn();
    const { result } = renderHook(() => useTakeRecorder({ onTake }));

    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.stop();
    });

    expect(onTake).not.toHaveBeenCalled();
  });

  it("stops itself at the cap", async () => {
    vi.useFakeTimers();
    const onTake = vi.fn();
    const { result } = renderHook(() => useTakeRecorder({ onTake, maxDurationMs: 3000 }));

    await act(async () => {
      await result.current.start();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(recorders[0].state).toBe("inactive");
    expect(onTake).toHaveBeenCalledTimes(1);
  });

  it("reports a refused microphone instead of throwing", async () => {
    micThrows = new Error("NotAllowedError");
    const { result } = renderHook(() => useTakeRecorder({ onTake: vi.fn() }));

    await act(async () => {
      expect(await result.current.start()).toBe(false);
    });

    expect(result.current.error).toMatch(/refused/i);
    expect(result.current.isRecording).toBe(false);
  });

  it("reports an unsupported device", async () => {
    (globalThis as Record<string, unknown>).MediaRecorder = undefined;
    const { result } = renderHook(() => useTakeRecorder({ onTake: vi.fn() }));

    await act(async () => {
      expect(await result.current.start()).toBe(false);
    });

    expect(result.current.error).toMatch(/isn't available/i);
    expect(result.current.supported).toBe(false);
  });

  it("stops a running take when the card goes away", async () => {
    const { result, unmount } = renderHook(() => useTakeRecorder({ onTake: vi.fn() }));
    await act(async () => {
      await result.current.start();
    });

    unmount();

    expect(recorders[0].state).toBe("inactive");
    expect(tracks[0].stop).toHaveBeenCalled();
  });
});
