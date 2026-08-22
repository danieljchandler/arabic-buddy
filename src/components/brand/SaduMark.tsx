import { cn } from "@/lib/utils";

import frameSand from "@/assets/sadu-frame-sand.svg";
import frameClear from "@/assets/sadu-frame.svg";
import hakiyaMark from "@/assets/hakiya-mark.png";

/**
 * The Hakiya mark, framed in a band of Sadu weave.
 *
 * The mark on its own is a speech bubble with an open silhouette and a
 * transparent ground, and both of those turn into problems the moment it sits
 * on anything but flat paper. On the app's own sadu border it put pattern on
 * pattern; on a dark ground its outline and tail are near-black, so the
 * silhouette stopped having an edge and by 32px it read as a smudge. Every
 * surface that wanted the mark ended up drawing a plate behind it in CSS.
 *
 * The band moves that plate into the artwork, where it belongs. Outside the
 * band the file is still genuinely transparent — that was the point of framing
 * rather than filling in behind — so this still sits on a page rather than in
 * a box.
 *
 * Two variants, because the ground inside the band is the part that has to
 * change:
 *
 * - `sand` puts the mark on the app's sand. It is the default and it is the
 *   one to reach for, because it is the only version that holds on a dark
 *   ground: the mark's own outline needs something light to be dark against.
 * - `clear` leaves the middle open. Use it where the surface behind is already
 *   light and a sand disc would read as a second, slightly-wrong shade — the
 *   app's own sand pages, or over pale artwork.
 *
 * **The mark itself is not baked into either frame.** The frames are the band
 * alone; this composites `hakiya-mark.png` into them at render time, so the
 * logo has exactly one source of truth on disk. If the mark is ever cleaned
 * up, one file changes and both frames follow.
 *
 * The band is traced from the artwork it was chosen off rather than redrawn,
 * for the same reason recorded for the play button in
 * `docs/play-button-directions.md`: a hand-built repeat is a fraction of the
 * size and does not look like the thing anybody agreed to.
 *
 * Not used in `BrandMark`, deliberately. That lockup already rides a plate,
 * and the plate is there for the *wordmark* as much as the mark — so a framed
 * mark inside it would be a ground sitting on a ground. The frame earns its
 * place where the mark stands alone in a round slot.
 */

/**
 * How much of the box the mark occupies, as a percentage of its width.
 *
 * The band's inner edge is at r=23.393 of a 64 viewBox, so the opening is 73%
 * of the box. The mark is set well inside that: it is wider than it is tall,
 * and crowding the band is what makes a framed mark look like a sticker.
 */
export const MARK_WIDTH_PERCENT = 62;

export type SaduMarkVariant = "sand" | "clear";

export interface SaduMarkProps {
  /** `sand` unless the surface behind is already light. */
  variant?: SaduMarkVariant;
  /** Sizing lives here — the art has no intrinsic size. */
  className?: string;
  /** Give it a label only where it carries meaning of its own. */
  title?: string;
}

export function SaduMark({ variant = "sand", className, title }: SaduMarkProps) {
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("relative block aspect-square", className)}
    >
      <img
        src={variant === "sand" ? frameSand : frameClear}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full"
        draggable={false}
      />
      <img
        src={hakiyaMark}
        alt=""
        aria-hidden
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: `${MARK_WIDTH_PERCENT}%` }}
        draggable={false}
      />
    </span>
  );
}
