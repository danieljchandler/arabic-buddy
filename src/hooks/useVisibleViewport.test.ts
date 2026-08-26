import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVisibleViewport } from "./useVisibleViewport";

/**
 * How much of the viewport the reader can actually see.
 *
 * The answer is "all of it" in a browser tab, and the hook says so by
 * returning null — a caller that got a band back for an ordinary page would
 * pin a bottom sheet to a measured pixel height and lose the `dvh` layout that
 * tracks a rotating phone. Inside a preview iframe the answer is a band, and
 * getting the numbers right is what keeps a bottom sheet inside the pane
 * rather than a thousand pixels below it.
 *
 * jsdom has no IntersectionObserver, which is the case worth pinning first:
 * the hook has to stay inert rather than throw.
 */

const VIEWPORT = window.innerHeight;

interface FakeEntry {
  top: number;
  height: number;
}

/**
 * An IntersectionObserver we can drive. Records what was observed, so the
 * probe's own lifecycle is testable alongside the numbers it reports.
 */
function installObserver() {
  const observed: Element[] = [];
  let emit: ((entry: FakeEntry) => void) | null = null;
  let disconnected = 0;

  class FakeIntersectionObserver {
    constructor(private callback: IntersectionObserverCallback) {
      emit = (entry) => {
        const rect = {
          top: entry.top,
          bottom: entry.top + entry.height,
          height: entry.height,
        } as DOMRectReadOnly;
        this.callback(
          [{ intersectionRect: rect } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      };
    }
    observe(el: Element) {
      observed.push(el);
    }
    disconnect() {
      disconnected += 1;
    }
    unobserve() {}
    takeRecords() {
      return [];
    }
  }

  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

  return {
    observed,
    get disconnects() {
      return disconnected;
    },
    /** Report a visible band, as the observer would after a host scroll. */
    report(entry: FakeEntry) {
      act(() => emit?.(entry));
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll("[aria-hidden='true']").forEach((el) => el.remove());
});

describe("useVisibleViewport", () => {
  it("stays inert where there is no IntersectionObserver", () => {
    const { result } = renderHook(() => useVisibleViewport(true));
    expect(result.current).toBeNull();
  });

  it("reports nothing when the whole viewport is visible", () => {
    const observer = installObserver();
    const { result } = renderHook(() => useVisibleViewport(true));

    observer.report({ top: 0, height: VIEWPORT });

    // Not a band of the full height — null, so the caller's dvh geometry
    // stands and an ordinary tab is left exactly as it was.
    expect(result.current).toBeNull();
  });

  it("measures the band when a host clips the frame from below", () => {
    const observer = installObserver();
    const { result } = renderHook(() => useVisibleViewport(true));

    // The preview case: a 700px pane showing the top of a much taller frame.
    observer.report({ top: 0, height: 700 });

    expect(result.current).toEqual({
      top: 0,
      bottom: VIEWPORT - 700,
      height: 700,
    });
  });

  it("follows the band when the host scrolls the frame under it", () => {
    const observer = installObserver();
    const { result } = renderHook(() => useVisibleViewport(true));

    observer.report({ top: 120, height: 400 });

    expect(result.current).toEqual({
      top: 120,
      bottom: VIEWPORT - 520,
      height: 400,
    });

    // The host pane grows; the band has to grow with it, or the panel keeps
    // the size of a window that is no longer there.
    observer.report({ top: 0, height: 600 });
    expect(result.current?.height).toBe(600);
  });

  it("ignores a sub-pixel shortfall", () => {
    const observer = installObserver();
    const { result } = renderHook(() => useVisibleViewport(true));

    // A fractional rect or a host's one-pixel border is not a clipped preview,
    // and moving a panel for it would be a jitter with no cause on screen.
    observer.report({ top: 0, height: VIEWPORT - 1 });

    expect(result.current).toBeNull();
  });

  it("observes a probe of its own, and takes it away again", () => {
    const observer = installObserver();
    const { unmount } = renderHook(() => useVisibleViewport(true));

    // Its own element: observing the panel would feed the panel's size back
    // into the measurement that sets it.
    expect(observer.observed).toHaveLength(1);
    const probe = observer.observed[0];
    expect(probe.isConnected).toBe(true);
    expect(probe.getAttribute("aria-hidden")).toBe("true");

    unmount();

    expect(observer.disconnects).toBe(1);
    expect(probe.isConnected).toBe(false);
  });

  it("measures nothing while it is disabled", () => {
    const observer = installObserver();
    const { result } = renderHook(() => useVisibleViewport(false));

    expect(observer.observed).toHaveLength(0);
    expect(result.current).toBeNull();
  });
});
