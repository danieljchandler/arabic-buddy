import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DANCE_MUSIC_FADE_MS, DANCE_MUSIC_START_TIMEOUT_MS, DANCE_MUSIC_VOLUME } from "@/lib/danceMusic";
import { useDanceMusic } from "./useDanceMusic";

/**
 * The music under a celebration's dance. It loops while the screen is up and
 * fades when it goes, and it tells the scene when to start dancing: on the
 * music's first beat when it plays, and soon anyway when it cannot.
 */

class FakeAudio {
  static instances: FakeAudio[] = [];
  loop = false;
  volume = 1;
  private listeners = new Map<string, Set<() => void>>();
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  constructor(public src: string) {
    FakeAudio.instances.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }
  emit(type: string) {
    this.listeners.get(type)?.forEach((fn) => fn());
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeAudio.instances = [];
  vi.stubGlobal("Audio", FakeAudio);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useDanceMusic", () => {
  it("plays the loop, looping, under the other sounds", () => {
    renderHook(() => useDanceMusic("/ardah.mp3"));
    const [audio] = FakeAudio.instances;
    expect(audio.src).toBe("/ardah.mp3");
    expect(audio.loop).toBe(true);
    expect(audio.volume).toBe(DANCE_MUSIC_VOLUME);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("holds the dance until the music is playing", () => {
    const { result } = renderHook(() => useDanceMusic("/ardah.mp3"));
    expect(result.current).toBe(false);
    act(() => FakeAudio.instances[0].emit("playing"));
    expect(result.current).toBe(true);
  });

  it("dances anyway when the music is slow to start", () => {
    const { result } = renderHook(() => useDanceMusic("/ardah.mp3"));
    act(() => vi.advanceTimersByTime(DANCE_MUSIC_START_TIMEOUT_MS - 1));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it("dances anyway when the browser refuses to play or the file fails", async () => {
    vi.stubGlobal(
      "Audio",
      class extends FakeAudio {
        play = vi.fn(() => Promise.reject(new DOMException("no", "NotAllowedError")));
      },
    );
    const refused = renderHook(() => useDanceMusic("/ardah.mp3"));
    await act(async () => {});
    expect(refused.result.current).toBe(true);

    vi.stubGlobal("Audio", FakeAudio);
    const broken = renderHook(() => useDanceMusic("/missing.mp3"));
    act(() => FakeAudio.instances[FakeAudio.instances.length - 1].emit("error"));
    expect(broken.result.current).toBe(true);
  });

  it("dances at once, in silence, with no music", () => {
    const { result } = renderHook(() => useDanceMusic(null));
    expect(result.current).toBe(true);
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("fades out and stops when the celebration closes", () => {
    const { unmount } = renderHook(() => useDanceMusic("/ardah.mp3"));
    const [audio] = FakeAudio.instances;
    unmount();
    expect(audio.pause).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(DANCE_MUSIC_FADE_MS / 2));
    expect(audio.volume).toBeGreaterThan(0);
    expect(audio.volume).toBeLessThan(DANCE_MUSIC_VOLUME);
    act(() => vi.advanceTimersByTime(DANCE_MUSIC_FADE_MS));
    expect(audio.volume).toBe(0);
    expect(audio.pause).toHaveBeenCalledTimes(1);
  });
});
