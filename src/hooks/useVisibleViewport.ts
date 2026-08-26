import { useEffect, useState } from "react";

/**
 * The slice of the viewport the reader can actually see.
 *
 * A page normally owns its whole viewport, so `100dvh` and a `bottom: 0` panel
 * land where you'd expect. Embedded in an iframe, they don't: the layout
 * viewport is the *frame's* height, which can be far taller than the pane the
 * frame is shown in. A preview host (Lovable's preview, an editor's live
 * pane, an embedded demo) routinely gives the frame a 2000px viewport inside a
 * 700px window, and everything anchored to the bottom of the viewport —
 * bottom sheets above all — is laid out in the part nobody can see. Worse than
 * being off-screen, it *looks* fine: the sheet's own scroll container is a
 * thousand pixels tall, so it never overflows, never scrolls, and quietly
 * strands the rest of a long answer below the fold with nothing to scroll.
 *
 * `visualViewport` is no help here — inside a frame it reports the frame's own
 * viewport. An IntersectionObserver does report it: with the implicit root the
 * intersection is clipped by every ancestor frame, so observing a
 * viewport-sized probe hands back exactly the visible band, in this document's
 * own client coordinates, and updates when the host scrolls or resizes.
 *
 * Returns `null` in the ordinary case — a real browser tab, where the visible
 * band *is* the viewport — so callers can leave their `dvh` geometry alone and
 * only override it when there is something to correct.
 */

export interface VisibleBand {
  /** Distance from the top of the layout viewport to the top of the band. */
  top: number;
  /** Distance from the bottom of the band to the bottom of the layout viewport. */
  bottom: number;
  /** Height of the band. */
  height: number;
}

/**
 * Sub-pixel intersection rects and a host's one-pixel border are not a clipped
 * preview. Only a real gap is worth moving a panel for.
 */
const SLACK_PX = 4;

/**
 * A fine threshold grid, because the interesting changes are small ones: the
 * observer only re-fires when the ratio crosses a threshold, and a pane
 * resized by a few percent has to move the panel with it.
 */
const THRESHOLDS = Array.from({ length: 101 }, (_, i) => i / 100);

export function useVisibleViewport(enabled: boolean): VisibleBand | null {
  const [band, setBand] = useState<VisibleBand | null>(null);

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") {
      setBand(null);
      return;
    }

    // Its own element rather than the panel: the probe must be the size of the
    // viewport whatever the panel is doing, and observing the panel would make
    // its own resize the next measurement's input.
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;inset:0;pointer-events:none;opacity:0;z-index:-1";
    document.body.appendChild(probe);

    const observer = new IntersectionObserver(
      (entries) => {
        const rect = entries[entries.length - 1]?.intersectionRect;
        const viewport = window.innerHeight;
        if (!rect || rect.height <= 0 || viewport - rect.height < SLACK_PX) {
          setBand(null);
          return;
        }
        setBand({
          top: Math.round(rect.top),
          bottom: Math.round(viewport - rect.bottom),
          height: Math.round(rect.height),
        });
      },
      { threshold: THRESHOLDS },
    );
    observer.observe(probe);

    return () => {
      observer.disconnect();
      probe.remove();
    };
  }, [enabled]);

  return band;
}
