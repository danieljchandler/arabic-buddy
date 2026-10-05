import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { ListenButton, StepChecklist } from "./SessionChrome";

/**
 * The chrome the guided tutor sessions share. The checklist has to say which
 * step the learner is on and which are behind them, for any set of steps;
 * the listen link has to exist only where there is Arabic to read, and has
 * to actually be heard on a phone — the first version fetched the speech and
 * only then made an element to play it, which iOS refuses once the tap is
 * over. That case is pinned here because the e2e browser runs with
 * `--autoplay-policy=no-user-gesture-required` and cannot see it.
 */

const speech = vi.hoisted(() => ({ fetchSpeechBlob: vi.fn() }));
vi.mock("@/lib/speakArabic", () => ({ fetchSpeechBlob: speech.fetchSpeechBlob }));

const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toasts.error(...args) },
}));

interface FakeAudio {
  src: string;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}

/** Every element the button made, and the `src` at each `play()` — the silent priming clip included. */
const created: FakeAudio[] = [];
const plays: string[] = [];
const originalAudio = globalThis.Audio;
let nextUrl = 0;
/** What `play()` does; a browser that refuses playback rejects. */
let playResult: () => Promise<void> = () => Promise.resolve();

const spoken = () => plays.filter((src) => !src.startsWith("data:"));

let cleanup: (() => void) | undefined;

beforeEach(() => {
  created.length = 0;
  plays.length = 0;
  nextUrl = 0;
  playResult = () => Promise.resolve();
  speech.fetchSpeechBlob.mockReset();
  speech.fetchSpeechBlob.mockImplementation(async () => new Blob(["bytes"]));
  toasts.error.mockReset();
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => `blob:clip-${++nextUrl}`),
    revokeObjectURL: vi.fn(),
  });
  globalThis.Audio = class {
    src: string;
    play = vi.fn(() => {
      plays.push(this.src);
      return playResult();
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
  cleanup?.();
  cleanup = undefined;
  globalThis.Audio = originalAudio;
  vi.unstubAllGlobals();
});

type Step = "one" | "two" | "three";
const labels: Record<Step, string> = { one: "First", two: "Second", three: "Third" };

describe("StepChecklist", () => {
  it("marks the current step and ticks the finished ones, in the labels it is given", () => {
    cleanup = renderWithProviders(
      <StepChecklist<Step> steps={["one", "two", "three"]} current="two" done={new Set<Step>(["one"])} labels={labels} />,
    ).cleanup;

    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["First", "2Second", "3Third"]);
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[0].querySelector('[aria-label="Done"]')).not.toBeNull();
  });

  it("has no current step once the session is over", () => {
    cleanup = renderWithProviders(
      <StepChecklist<Step> steps={["one", "two"]} current={null} done={new Set<Step>(["one", "two"])} labels={labels} />,
    ).cleanup;
    expect(screen.queryByRole("listitem", { current: "step" })).toBeNull();
    expect(screen.getAllByLabelText("Done")).toHaveLength(2);
  });
});

describe("ListenButton", () => {
  const MESSAGE = "Say: شلونك اليوم؟ — then: زين";
  const listen = () => screen.getByRole("button", { name: /listen to the arabic/i });

  it("is not there for a message with no Arabic in it", () => {
    cleanup = renderWithProviders(<ListenButton text="Well done, keep going." dialect="Gulf" />).cleanup;
    expect(screen.queryByRole("button")).toBeNull();
    expect(speech.fetchSpeechBlob).not.toHaveBeenCalled();
  });

  it("reads only the Arabic aloud, run by run, in the session's dialect", async () => {
    cleanup = renderWithProviders(<ListenButton text={MESSAGE} dialect="Egyptian" />).cleanup;

    fireEvent.click(listen());

    // The first run speaks; the second is fetched while it does, so the
    // read-through does not pause for a round trip between them.
    await waitFor(() => expect(spoken()).toEqual(["blob:clip-1"]));
    await waitFor(() => expect(speech.fetchSpeechBlob).toHaveBeenCalledTimes(2));
    expect(speech.fetchSpeechBlob.mock.calls.map(([req]) => req)).toEqual([
      { text: "شلونك اليوم؟", dialect: "Egyptian" },
      { text: "زين", dialect: "Egyptian" },
    ]);

    await act(async () => created[0].onended?.());
    await waitFor(() => expect(spoken()).toEqual(["blob:clip-1", "blob:clip-2"]));
    await act(async () => created[0].onended?.());
    await waitFor(() => expect(listen()).toHaveAttribute("aria-pressed", "false"));
  });

  it("spends the tap's activation before the speech exists, so a phone will play it", async () => {
    let release: (blob: Blob) => void = () => {};
    speech.fetchSpeechBlob.mockImplementationOnce(() => new Promise<Blob>((resolve) => { release = resolve; }));
    cleanup = renderWithProviders(<ListenButton text="قول: مرحبا" dialect="Gulf" />).cleanup;

    fireEvent.click(listen());

    // Synchronously, while the tap is still the reason anything is happening:
    // an element exists and has been played. That is what lets the same
    // element be given the real clip once it arrives.
    expect(created).toHaveLength(1);
    expect(plays).toEqual([expect.stringMatching(/^data:audio\/wav/)]);

    await act(async () => release(new Blob(["bytes"])));

    await waitFor(() => expect(spoken()).toEqual(["blob:clip-1"]));
    expect(created).toHaveLength(1);
  });

  it("says so when there is no audio to play, instead of a spinner that stops in silence", async () => {
    speech.fetchSpeechBlob.mockResolvedValue(null);
    cleanup = renderWithProviders(<ListenButton text="قول: مرحبا" dialect="Gulf" />).cleanup;

    fireEvent.click(listen());

    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("Couldn't play the audio"));
    expect(spoken()).toEqual([]);
    expect(listen()).toHaveAttribute("aria-pressed", "false");
  });

  it("says so when the browser refuses to play the clip", async () => {
    playResult = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));
    cleanup = renderWithProviders(<ListenButton text="قول: مرحبا" dialect="Gulf" />).cleanup;

    fireEvent.click(listen());

    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("Couldn't play the audio"));
    expect(toasts.error).toHaveBeenCalledTimes(1);
  });

  it("stops when tapped again, and that is not reported as a failure", async () => {
    cleanup = renderWithProviders(<ListenButton text={MESSAGE} dialect="Gulf" />).cleanup;

    fireEvent.click(listen());
    await waitFor(() => expect(listen()).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(listen());

    await waitFor(() => expect(listen()).toHaveAttribute("aria-pressed", "false"));
    expect(created[0].pause).toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
  });
});
