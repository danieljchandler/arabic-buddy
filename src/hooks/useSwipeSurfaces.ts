import { useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Horizontal swipe between the app's top-level surfaces.
 *
 * The direction question is settled here, once, so no call site has to think
 * about it. The app's chrome runs left-to-right, so "forward" is a drag toward
 * the LEFT — the gesture that pulls the next page in from the right, the
 * direction an English reader's eye travels. That puts the chooser to the
 * right of the feed. (Ingleezy, this app's RTL sibling, resolves the same
 * question the mirrored way; the physical gesture happens to coincide, the
 * reasoning does not.)
 *
 * Vertical intent wins ties: the feed scrolls up and down, and a swipe that is
 * mostly vertical must never be stolen by the pager.
 */

const MIN_DISTANCE = 60;
/** How much more horizontal than vertical a drag must be to count as a page turn. */
const AXIS_RATIO = 1.6;

export function useSwipeSurfaces({
  onNext,
  onPrev,
}: {
  /** Fired on a forward swipe — a leftward drag, pulling the next page in. */
  onNext?: () => void;
  /** Fired on a backward swipe — rightward. */
  onPrev?: () => void;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent) => {
    // Mouse drags are not swipes; only touch and pen turn pages.
    if (e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const from = start.current;
    start.current = null;
    if (!from) return;

    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) < MIN_DISTANCE) return;
    if (Math.abs(dx) < Math.abs(dy) * AXIS_RATIO) return;

    if (dx < 0) onNext?.();
    else onPrev?.();
  };

  return { onPointerDown, onPointerUp, onPointerCancel: () => { start.current = null; } };
}
