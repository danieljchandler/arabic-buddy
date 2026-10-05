import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { useVoiceAnswer } from "./useVoiceAnswer";

/**
 * Answering a tutor by voice. What matters: the recording is transcribed and
 * handed back as text rather than sent, a blocked microphone says so instead
 * of failing silently, and a transcript the recogniser could not produce
 * leaves the composer untouched.
 */

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const tracks = vi.hoisted(() => ({ stop: vi.fn() }));
const media = vi.hoisted(() => ({ getUserMedia: vi.fn() }));

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state = "inactive";
  mimeType = "audio/webm";

  constructor(public stream: MediaStream) {
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(16)], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

let cleanup: (() => void) | undefined;

beforeEach(() => {
  toast.error.mockReset();
  tracks.stop.mockReset();
  FakeMediaRecorder.instances = [];
  media.getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [tracks] } as unknown as MediaStream);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: media.getUserMedia },
  });
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

function render(onText: (text: string) => void, transcript: { text: string | null }) {
  const harness = renderHookWithProviders(() => useVoiceAnswer(onText), {
    persona: "free",
    seed: (b) => b.stubFunction("munsit-transcribe", transcript),
  });
  cleanup = harness.cleanup;
  return harness;
}

describe("useVoiceAnswer", () => {
  it("records, transcribes, and hands the text back to the composer", async () => {
    const onText = vi.fn();
    const { result, backend } = render(onText, { text: " مرحبا " });

    await act(async () => {
      await result.current.start();
    });
    expect(media.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(result.current.recording).toBe(true);
    expect(FakeMediaRecorder.instances[0].state).toBe("recording");

    act(() => result.current.stop());
    expect(result.current.recording).toBe(false);
    await waitFor(() => expect(onText).toHaveBeenCalledWith("مرحبا"));
    expect(result.current.transcribing).toBe(false);
    // The stream is released — a page that keeps the mic open keeps the tab's red dot on.
    expect(tracks.stop).toHaveBeenCalled();
    const sent = backend.lastCallTo("munsit-transcribe")?.body as { mimeType: string; audioBase64: string };
    expect(sent.mimeType).toBe("audio/webm");
    expect(sent.audioBase64.length).toBeGreaterThan(0);
  });

  it("says when the microphone is blocked, and records nothing", async () => {
    media.getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const onText = vi.fn();
    const { result } = render(onText, { text: "x" });

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.recording).toBe(false);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith("Microphone blocked", expect.anything());
    expect(onText).not.toHaveBeenCalled();
  });

  it("leaves the composer alone when nothing could be heard", async () => {
    const onText = vi.fn();
    const { result } = render(onText, { text: null });

    await act(async () => {
      await result.current.start();
    });
    act(() => result.current.stop());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't hear that", expect.anything()));
    expect(onText).not.toHaveBeenCalled();
  });
});
