import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLineAudio } from "./useLineAudio";

/**
 * Hearing a passage one line at a time.
 *
 * The reason all of a passage's lines live in one hook, rather than one hook
 * per line, is the read-through: deciding what to play next requires knowing
 * that the previous clip ended, and the line that just finished is not in a
 * position to start its successor. Everything below is about that seam —
 * advancing on `ended`, stopping on demand, and not letting a synthesis that
 * was already in flight start speaking after the learner asked for silence.
 *
 * The other half is spending. This is the read view of an article, not a
 * listening exercise: synthesis is metered against a learner's daily cap, so
 * nothing may be requested until it is asked for, and a clip already paid for
 * must never be bought twice.
 */

interface FakeAudio {
  src: string;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  onpause: (() => void) | null;
}

const fetchSpeechBlob = vi.fn();

vi.mock("@/lib/speakArabic", () => ({
  fetchSpeechBlob: (...args: unknown[]) => fetchSpeechBlob(...args),
}));

vi.mock("@/contexts/DialectContext", () => ({
  useDialect: () => ({ activeDialect: "Gulf" }),
}));

const created: FakeAudio[] = [];
const originalAudio = globalThis.Audio;
let nextUrl = 0;

const LINES = ["السلام عليكم", "شلونك اليوم", "تمام الحمد لله"];

/** Finish the clip that is currently sounding, the way a real one ends. */
const endCurrent = async () => {
  const audio = created[created.length - 1];
  await act(async () => {
    audio.onended?.();
  });
};

beforeEach(() => {
  created.length = 0;
  nextUrl = 0;
  fetchSpeechBlob.mockReset();
  fetchSpeechBlob.mockImplementation(async () => new Blob(["bytes"]));

  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => `blob:clip-${++nextUrl}`),
    revokeObjectURL: vi.fn(),
  });

  globalThis.Audio = class {
    src: string;
    play = vi.fn(() => Promise.resolve());
    pause = vi.fn(() => this.onpause?.());
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onpause: (() => void) | null = null;
    constructor(src: string) {
      this.src = src;
      created.push(this as unknown as FakeAudio);
    }
  } as unknown as typeof Audio;
});

afterEach(() => {
  globalThis.Audio = originalAudio;
  vi.unstubAllGlobals();
});

describe("useLineAudio", () => {
  it("says nothing until it is asked to", () => {
    renderHook(() => useLineAudio({ lines: LINES }));

    // A page of speakers that synthesised on mount would spend a learner's
    // daily cap on lines they never pressed play on.
    expect(fetchSpeechBlob).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it("plays the line that was asked for, in the active dialect", async () => {
    const { result } = renderHook(() => useLineAudio({ lines: LINES }));

    act(() => result.current.playLine(1));
    await waitFor(() => expect(result.current.playingIndex).toBe(1));

    expect(fetchSpeechBlob).toHaveBeenCalledTimes(1);
    expect(fetchSpeechBlob.mock.calls[0][0]).toMatchObject({
      text: LINES[1],
      dialect: "Gulf",
    });
    expect(created).toHaveLength(1);
    expect(created[0].play).toHaveBeenCalled();
  });

  it("prefers an explicit dialect over the learner's active one", async () => {
    const { result } = renderHook(() =>
      useLineAudio({ lines: LINES, dialect: "Yemeni" }),
    );

    act(() => result.current.playLine(0));
    await waitFor(() => expect(result.current.playingIndex).toBe(0));

    expect(fetchSpeechBlob.mock.calls[0][0].dialect).toBe("Yemeni");
  });

  it("stops at the end of a single line rather than reading on", async () => {
    const { result } = renderHook(() => useLineAudio({ lines: LINES }));

    act(() => result.current.playLine(0));
    await waitFor(() => expect(result.current.playingIndex).toBe(0));
    await endCurrent();

    await waitFor(() => expect(result.current.playingIndex).toBeNull());
    expect(result.current.isPlayingAll).toBe(false);
    expect(created).toHaveLength(1);
  });

  it("walks the whole passage on play all, one line after the next", async () => {
    const { result } = renderHook(() => useLineAudio({ lines: LINES }));

    act(() => result.current.playAll());
    await waitFor(() => expect(result.current.playingIndex).toBe(0));
    expect(result.current.isPlayingAll).toBe(true);

    await endCurrent();
    await waitFor(() => expect(result.current.playingIndex).toBe(1));
    await endCurrent();
    await waitFor(() => expect(result.current.playingIndex).toBe(2));
    await endCurrent();

    await waitFor(() => expect(result.current.isPlayingAll).toBe(false));
    expect(result.current.playingIndex).toBeNull();
    expect(created.map((a) => a.src)).toEqual([
      "blob:clip-1",
      "blob:clip-2",
      "blob:clip-3",
    ]);
  });

  it("fetches the next line while the current one is speaking", async () => {
    const { result } = renderHook(() => useLineAudio({ lines: LINES }));

    act(() => result.current.playAll());
    await waitFor(() => expect(result.current.playingIndex).toBe(0));

    // The TTS queue is serial, so waiting until a line ends to ask for the next
    // one puts a round trip of silence between every sentence.
    await waitFor(() => expect(fetchSpeechBlob).toHaveBeenCalledTimes(2));
    expect(fetchSpeechBlob.mock.calls[1][0].text).toBe(LINES[1]);
  });

  it("buys a clip once, however often the learner replays the line", async () => {
    const { result } = renderHook(() => useLineAudio({ lines: LINES }));

    act(() => result.current.playLine(0));
    await waitFor(() => expect(result.current.playingIndex).toBe(0));
    await endCurrent();
    await waitFor(() => expect(result.current.playingIndex).toBeNull());

    act(() => result.current.playLine(0));
    await waitFor(() => expect(result.current.playingIndex).toBe(0));

    expect(fetchSpeechBlob).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(2);
  });

  it("treats a second tap on the sounding line as stop", async () => {
    const { result } = renderHook(() => useLineAudio({ lines: LINES }));

    act(() => result.current.playLine(0));
    await waitFor(() => expect(result.current.playingIndex).toBe(0));

    act(() => result.current.playLine(0));

    expect(created[0].pause).toHaveBeenCalled();
    await waitFor(() => expect(result.current.playingIndex).toBeNull());
  });

  it("stops the read-through where it is, without starting the next line", async () => {
    const { result } = renderHook(() => useLineAudio({ lines: LINES }));

    act(() => result.current.playAll());
    await waitFor(() => expect(result.current.playingIndex).toBe(0));

    act(() => result.current.playAll());

    await waitFor(() => expect(result.current.isPlayingAll).toBe(false));
    expect(result.current.playingIndex).toBeNull();
    // The clip for line 1 was already prefetched; what must not happen is it
    // being played.
    await new Promise((r) => setTimeout(r, 10));
    expect(created).toHaveLength(1);
  });

  it("does not start speaking a clip that landed after the learner stopped", async () => {
    let release: (blob: Blob) => void = () => {};
    fetchSpeechBlob.mockImplementationOnce(
      () => new Promise<Blob>((resolve) => { release = resolve; }),
    );
    const { result } = renderHook(() => useLineAudio({ lines: LINES }));

    act(() => result.current.playLine(0));
    await waitFor(() => expect(result.current.loadingIndex).toBe(0));

    act(() => result.current.stop());
    await act(async () => {
      release(new Blob(["bytes"]));
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(created).toHaveLength(0);
    expect(result.current.playingIndex).toBeNull();
    expect(result.current.loadingIndex).toBeNull();
  });

  it("goes quiet when the passage is replaced", async () => {
    const { result, rerender } = renderHook(
      ({ lines }: { lines: string[] }) => useLineAudio({ lines }),
      { initialProps: { lines: LINES } },
    );

    act(() => result.current.playAll());
    await waitFor(() => expect(result.current.playingIndex).toBe(0));

    // Positions mean nothing across a change of content: a read-through that
    // carried into the next article would be reading line 2 of a story the
    // learner never opened.
    rerender({ lines: ["خبر ثاني", "وسطر ثاني"] });

    await waitFor(() => expect(result.current.isPlayingAll).toBe(false));
    expect(created[0].pause).toHaveBeenCalled();
    expect(result.current.playingIndex).toBeNull();
  });

  it("stays silent when the provider has no audio to give", async () => {
    fetchSpeechBlob.mockResolvedValue(null);
    const { result } = renderHook(() => useLineAudio({ lines: LINES }));

    act(() => result.current.playAll());

    await waitFor(() => expect(result.current.isPlayingAll).toBe(false));
    expect(created).toHaveLength(0);
    expect(result.current.loadingIndex).toBeNull();

    // A failure is not cached: a 401 that signing in fixes must not leave the
    // line permanently mute.
    fetchSpeechBlob.mockResolvedValue(new Blob(["bytes"]));
    act(() => result.current.playLine(0));
    await waitFor(() => expect(result.current.playingIndex).toBe(0));
  });

  it("stops and releases its clips on unmount", async () => {
    const { result, unmount } = renderHook(() => useLineAudio({ lines: LINES }));

    act(() => result.current.playLine(0));
    await waitFor(() => expect(result.current.playingIndex).toBe(0));

    unmount();

    expect(created[0].pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clip-1");
  });
});
