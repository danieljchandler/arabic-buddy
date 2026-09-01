import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMonologueRecorder } from "./useMonologueRecorder";

/**
 * The long-form recorder behind the monologue feature.
 *
 * Its defining behaviour is what it does NOT do: useShadowRecorder auto-stops
 * on 600ms of trailing silence, and a monologue recorder that inherited that
 * would end the take at the learner's first thinking pause — the very thing
 * the fluency metrics exist to measure. So the tests here pin: silence never
 * stops a take, only the learner or the hard cap do, and a take with no speech
 * in it is reported as such rather than sent for paid transcription.
 */

const tracks = vi.hoisted(() => ({ stop: vi.fn() }));
const media = vi.hoisted(() => ({ getUserMedia: vi.fn() }));

/** What the fake analyser reports as the current microphone sample level. */
let micLevel = 0;

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = () => true;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state = "inactive";
  timeslice: number | undefined;

  constructor(
    public stream: MediaStream,
    public options?: MediaRecorderOptions,
  ) {
    FakeMediaRecorder.instances.push(this);
  }

  start(timeslice?: number) {
    this.timeslice = timeslice;
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    // Big enough to pass the "can't possibly contain speech" size floor.
    this.ondataavailable?.({ data: new Blob([new Uint8Array(8192)], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

class FakeAudioContext {
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  createAnalyser() {
    return {
      fftSize: 1024,
      getFloatTimeDomainData: (buf: Float32Array) => {
        buf.fill(micLevel);
      },
    };
  }
  close() {
    return Promise.resolve();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A real animation frame plus change, so the level meter has sampled the mic. */
const nextMeterFrame = () => act(() => sleep(40));

beforeEach(() => {
  micLevel = 0;
  tracks.stop.mockReset();
  FakeMediaRecorder.instances = [];
  media.getUserMedia.mockReset().mockResolvedValue({
    getTracks: () => [tracks],
  } as unknown as MediaStream);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: media.getUserMedia },
  });
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function startRecording(maxDurationMs = 60_000) {
  const onComplete = vi.fn();
  const hook = renderHook(() => useMonologueRecorder());
  await act(async () => {
    await hook.result.current.start({ maxDurationMs, onComplete });
  });
  return { ...hook, onComplete };
}

describe("starting", () => {
  it("asks for the microphone and starts capturing in timeslices", async () => {
    const { result } = await startRecording();

    expect(media.getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    expect(result.current.isRecording).toBe(true);
    // A timeslice, so a minutes-long take is flushed as it goes rather than
    // held as one growing chunk.
    expect(FakeMediaRecorder.instances[0].timeslice).toBe(1000);
  });

  it("reports a refused microphone without pretending to record", async () => {
    media.getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const { result, onComplete } = await startRecording();

    expect(result.current.permissionDenied).toBe(true);
    expect(result.current.error).toBe("Microphone access denied");
    expect(result.current.isRecording).toBe(false);
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("while recording", () => {
  it("keeps recording through long silences", async () => {
    const { result } = await startRecording();
    micLevel = 0.5;
    await nextMeterFrame();

    // 700ms of dead air — beyond the shadow recorder's auto-stop window. A
    // monologue's thinking pause is measurement material, not the end of the
    // take.
    micLevel = 0;
    await act(() => sleep(700));

    expect(result.current.isRecording).toBe(true);
  });

  it("counts elapsed time for the page's timer", async () => {
    const { result } = await startRecording();

    await act(() => sleep(300));

    expect(result.current.elapsedMs).toBeGreaterThan(0);
  });

  it("exposes the live input level for a meter", async () => {
    const { result } = await startRecording();
    micLevel = 0.5;

    await nextMeterFrame();

    expect(result.current.level).toBeGreaterThan(0);
  });
});

describe("stopping", () => {
  it("hands back the take when the learner stops it", async () => {
    const { result, onComplete } = await startRecording();
    micLevel = 0.5;
    await nextMeterFrame();

    act(() => {
      result.current.stop();
    });

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const [blob, reason, durationMs] = onComplete.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(reason).toBe("manual");
    expect(durationMs).toBeGreaterThan(0);
    expect(result.current.isRecording).toBe(false);
    expect(tracks.stop).toHaveBeenCalled();
  });

  it("stops at the hard cap with the cap named as the reason", async () => {
    const { result, onComplete } = await startRecording(60);
    micLevel = 0.5;
    await nextMeterFrame();

    await act(() => sleep(100));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete.mock.calls[0][1]).toBe("timeout");
    expect(result.current.isRecording).toBe(false);
  });

  it("reports a take with no speech in it instead of shipping silence", async () => {
    const { result, onComplete } = await startRecording();
    // The meter runs but never hears anything above the speech threshold.
    await nextMeterFrame();

    act(() => {
      result.current.stop();
    });

    // Null blob: the caller must not send 60 seconds of room tone to a paid
    // transcription API and then chart it as a fluency collapse.
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete.mock.calls[0][0]).toBeNull();
    expect(onComplete.mock.calls[0][1]).toBe("no-audio");
  });
});

describe("leaving the page", () => {
  it("releases the microphone and swallows the callback on unmount", async () => {
    const { unmount, onComplete } = await startRecording();
    micLevel = 0.5;
    await nextMeterFrame();

    unmount();

    expect(tracks.stop).toHaveBeenCalled();
    // Firing onComplete here would launch scoring network calls for a page
    // that no longer exists.
    expect(onComplete).not.toHaveBeenCalled();
  });
});
