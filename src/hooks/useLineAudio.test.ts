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
 *
 * Two of the cases below cannot be reached by the e2e suite at all, which is
 * why they are pinned here. The Playwright browser runs with
 * `--autoplay-policy=no-user-gesture-required`, so it cannot see a clip that
 * lost its user activation while it was being synthesised; and a page mounts
 * several of these hooks, which no single-hook render exercises.
 */

interface FakeAudio {
  src: string;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}

const fetchSpeechBlob = vi.fn();

vi.mock("@/lib/speakArabic", () => ({
  fetchSpeechBlob: (...args: unknown[]) => fetchSpeechBlob(...args),
}));

vi.mock("@/contexts/DialectContext", () => ({
  useDialect: () => ({ activeDialect: "Gulf" }),
}));

/** One element per hook, so what a clip did is read off `plays`, not off a new object. */
const created: FakeAudio[] = [];
/** The `src` at each `play()` call, priming clips included. */
const plays: string[] = [];
const originalAudio = globalThis.Audio;
let nextUrl = 0;

/** The clips that were actually speech, i.e. not the silent priming clip. */
const spoken = () => plays.filter((src) => !src.startsWith("data:"));

const LINES = ["السلام عليكم", "شلونك اليوم", "تمام الحمد لله"];

/** Finish the clip that is currently sounding, the way a real one ends. */
const endCurrent = async (audio: FakeAudio = created[created.length - 1]) => {
  await act(async () => {
    audio.onended?.();
  });
};

beforeEach(() => {
  created.length = 0;
  plays.length = 0;
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
    play = vi.fn(() => {
      plays.push(this.src);
      return Promise.resolve();
    });
    pause = vi.fn();
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(src = "") {
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
    expect(spoken()).toEqual(["blob:clip-1"]);
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
    expect(spoken()).toHaveLength(1);
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
    expect(spoken()).toEqual(["blob:clip-1", "blob:clip-2", "blob:clip-3"]);
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
    // Played twice, synthesised once.
    expect(spoken()).toEqual(["blob:clip-1", "blob:clip-1"]);
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
    expect(spoken()).toEqual(["blob:clip-1"]);
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
    expect(spoken()).toEqual([]);
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
    expect(spoken()).toEqual([]);
    expect(result.current.loadingIndex).toBeNull();

    // A failure is not cached: a 401 that signing in fixes must not leave the
    // line permanently mute.
    fetchSpeechBlob.mockResolvedValue(new Blob(["bytes"]));
    act(() => result.current.playLine(0));
    await waitFor(() => expect(result.current.playingIndex).toBe(0));
  });

  it("spends the tap's activation before the clip it will play exists", async () => {
    // iOS Safari only lets audio start from inside a gesture, and synthesis
    // outlives one. Without this the first tap on every line fetched a clip and
    // silently failed to play it. The e2e browser runs with
    // --autoplay-policy=no-user-gesture-required and cannot see it.
    let release: (blob: Blob) => void = () => {};
    fetchSpeechBlob.mockImplementationOnce(
      () => new Promise<Blob>((resolve) => { release = resolve; }),
    );
    const { result } = renderHook(() => useLineAudio({ lines: LINES }));

    act(() => result.current.playLine(0));

    // Synchronously, while the tap is still the reason anything is happening:
    // an element exists and has been played.
    expect(created).toHaveLength(1);
    expect(plays).toEqual([expect.stringMatching(/^data:audio\/wav/)]);

    await act(async () => release(new Blob(["bytes"])));

    // The same element speaks the line — an element that has played once under
    // a gesture may be given a new source later.
    await waitFor(() => expect(result.current.playingIndex).toBe(0));
    expect(created).toHaveLength(1);
    expect(spoken()).toEqual(["blob:clip-1"]);
  });

  it("primes once, not on every tap", async () => {
    const { result } = renderHook(() => useLineAudio({ lines: LINES }));

    act(() => result.current.playLine(0));
    await waitFor(() => expect(result.current.playingIndex).toBe(0));
    act(() => result.current.playLine(1));
    await waitFor(() => expect(result.current.playingIndex).toBe(1));

    // A second silent clip would cut off the line that is speaking.
    expect(plays.filter((src) => src.startsWith("data:"))).toHaveLength(1);
  });

  it("silences another passage on the page rather than talking over it", async () => {
    // A Souq News page mounts one of these per article and one per headline.
    // Two clips of Arabic at once are not two things a learner can hear.
    const headline = renderHook(() => useLineAudio({ lines: ["السوق اليوم"] }));
    const article = renderHook(() => useLineAudio({ lines: LINES }));

    act(() => headline.result.current.playLine(0));
    await waitFor(() => expect(headline.result.current.playingIndex).toBe(0));

    act(() => article.result.current.playAll());
    await waitFor(() => expect(article.result.current.playingIndex).toBe(0));

    await waitFor(() => expect(headline.result.current.playingIndex).toBeNull());
    expect(created[0].pause).toHaveBeenCalled();
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
