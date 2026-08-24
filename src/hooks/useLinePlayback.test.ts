import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEAD_IN_SECONDS, SLOW_RATE, useLinePlayback } from "./useLinePlayback";

/**
 * A stand-in for the `<audio>`/`<video>` element the workspace renders.
 *
 * jsdom has no media pipeline — `play()` is not implemented and `currentTime`
 * never advances on its own — so the clock is driven by hand here. That is the
 * right shape for these tests anyway: what is under test is when the hook
 * decides a line has finished, and that decision has to be checked at exact
 * boundaries rather than whenever a real decoder happened to tick.
 */
function fakeMedia() {
  return {
    currentTime: 0,
    playbackRate: 1,
    paused: true,
    play: vi.fn(function (this: { paused: boolean }) {
      this.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(function (this: { paused: boolean }) {
      this.paused = true;
    }),
  };
}

type FakeMedia = ReturnType<typeof fakeMedia>;

/** Frames are run by hand so a test controls exactly when the watcher looks. */
let frames: Array<() => void>;

function runFrame() {
  const queued = frames;
  frames = [];
  for (const frame of queued) frame();
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(media: FakeMedia = fakeMedia()) {
  const ref = { current: media as unknown as HTMLMediaElement };
  const view = renderHook(() => useLinePlayback(ref));
  return { media, view };
}

const span = { id: "L1", start: 10, end: 12 };

describe("playing one line", () => {
  it("seeks to the line and starts playing", () => {
    const { media, view } = setup();

    act(() => view.result.current.playLine(span));

    expect(media.currentTime).toBeCloseTo(10 - LEAD_IN_SECONDS);
    expect(media.play).toHaveBeenCalled();
    expect(view.result.current.playingLineId).toBe("L1");
  });

  it("does not seek before the start of the file", () => {
    const { media, view } = setup();

    act(() => view.result.current.playLine({ id: "L0", start: 0, end: 1 }));

    expect(media.currentTime).toBe(0);
  });

  it("stops at the end of the line", () => {
    const { media, view } = setup();
    act(() => view.result.current.playLine(span));

    act(() => {
      media.currentTime = 12.01;
      runFrame();
    });

    expect(media.pause).toHaveBeenCalled();
    expect(view.result.current.playingLineId).toBeNull();
  });

  it("keeps playing while still inside the line", () => {
    const { media, view } = setup();
    act(() => view.result.current.playLine(span));

    act(() => {
      media.currentTime = 11;
      runFrame();
    });

    expect(media.pause).not.toHaveBeenCalled();
    expect(view.result.current.playingLineId).toBe("L1");
  });

  it("ignores a span with no duration", () => {
    const { media, view } = setup();

    act(() => view.result.current.playLine({ id: "bad", start: 5, end: 5 }));

    expect(media.play).not.toHaveBeenCalled();
    expect(view.result.current.playingLineId).toBeNull();
  });

  it("ignores a span with timings that are not numbers", () => {
    const { media, view } = setup();

    act(() =>
      view.result.current.playLine({ id: "bad", start: Number.NaN, end: 4 }),
    );

    expect(media.play).not.toHaveBeenCalled();
  });

  it("does nothing when there is no media element yet", () => {
    const ref = { current: null };
    const view = renderHook(() => useLinePlayback(ref));

    act(() => view.result.current.playLine(span));

    expect(view.result.current.playingLineId).toBeNull();
  });

  it("clears the playing row when the media refuses to play", async () => {
    const media = fakeMedia();
    media.play = vi.fn(() => Promise.reject(new Error("NotAllowedError")));
    const { view } = setup(media);

    await act(async () => {
      view.result.current.playLine(span);
      await Promise.resolve();
    });

    expect(view.result.current.playingLineId).toBeNull();
  });
});

describe("speed", () => {
  it("starts at normal speed", () => {
    const { view } = setup();
    expect(view.result.current.rate).toBe(1);
  });

  it("plays a line at the chosen speed", () => {
    const { media, view } = setup();

    act(() => view.result.current.setRate(0.65));
    act(() => view.result.current.playLine(span));

    expect(media.playbackRate).toBe(0.65);
  });

  it("applies a speed change to the line already playing", () => {
    const { media, view } = setup();
    act(() => view.result.current.playLine(span));

    act(() => view.result.current.setRate(0.5));

    expect(media.playbackRate).toBe(0.5);
  });

  it("plays one line slowly without changing the chosen speed", () => {
    const { media, view } = setup();

    act(() => view.result.current.playLineSlow(span));

    expect(media.playbackRate).toBe(SLOW_RATE);
    expect(view.result.current.rate).toBe(1);
  });

  it("puts the element back to normal speed when playback stops", () => {
    // Otherwise a reviewer who slowed one line down finds the whole video
    // running slow the next time they press play on the player itself.
    const { media, view } = setup();
    act(() => view.result.current.playLine(span, 0.5));

    act(() => {
      media.currentTime = 99;
      runFrame();
    });

    expect(media.playbackRate).toBe(1);
  });
});

describe("looping", () => {
  it("is off by default", () => {
    const { view } = setup();
    expect(view.result.current.loop).toBe(false);
  });

  it("restarts the line instead of stopping", () => {
    const { media, view } = setup();
    act(() => view.result.current.setLoop(true));
    act(() => view.result.current.playLine(span));

    act(() => {
      media.currentTime = 12.5;
      runFrame();
    });

    expect(media.currentTime).toBeCloseTo(10 - LEAD_IN_SECONDS);
    expect(view.result.current.playingLineId).toBe("L1");
    expect(media.pause).not.toHaveBeenCalled();
  });

  it("picks up a loop toggled on mid-line", () => {
    const { media, view } = setup();
    act(() => view.result.current.playLine(span));
    act(() => view.result.current.setLoop(true));

    act(() => {
      media.currentTime = 12.5;
      runFrame();
    });

    expect(view.result.current.playingLineId).toBe("L1");
  });
});

describe("stopping", () => {
  it("pauses and clears the playing row", () => {
    const { media, view } = setup();
    act(() => view.result.current.playLine(span));

    act(() => view.result.current.stop());

    expect(media.pause).toHaveBeenCalled();
    expect(view.result.current.playingLineId).toBeNull();
  });

  it("switches cleanly from one line to another", () => {
    const { media, view } = setup();
    act(() => view.result.current.playLine(span));

    act(() => view.result.current.playLine({ id: "L2", start: 20, end: 22 }));

    expect(view.result.current.playingLineId).toBe("L2");
    expect(media.currentTime).toBeCloseTo(20 - LEAD_IN_SECONDS);
  });

  it("does not keep watching the clock after unmount", () => {
    const { media, view } = setup();
    act(() => view.result.current.playLine(span));

    view.unmount();
    media.currentTime = 99;
    runFrame();

    // No throw, and no attempt to touch the element after teardown.
    expect(frames).toHaveLength(0);
  });
});
