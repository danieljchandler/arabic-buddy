import { cn } from "@/lib/utils";

/**
 * A single stepped sadu diamond — the small accent of the Ink direction.
 *
 * The owner's second sadu allowance (INK-FINAL §1): tiny marks used as a
 * section divider, a bullet in a row of meta labels, a dialect or
 * achievement marker. Never an emblem: 6–14px, in currentColor, so it is
 * oxblood or mustard on cream and cream or mustard on dark by whatever the
 * surrounding text colour already is.
 *
 * Drawn on a 7×7 grid of whole cells, the way a weave steps, with the open
 * "eye" in the middle that sadu diamonds carry. Decorative, so hidden from
 * assistive tech; anything it marks has to say so in words.
 */
export interface SaduDiamondProps {
  /** Rendered width and height in px. Clamped to the 6–14px the accent allows. */
  size?: number;
  /** Fill the eye — for a bullet small enough that the hole stops resolving. */
  solid?: boolean;
  className?: string;
}

const STEPPED = "M3 0h1v1h1v1h1v1h1v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1v-1h1v-1h1v-1h1z";
const EYE = "M3 3h1v1h-1z";

export function SaduDiamond({ size = 10, solid = false, className }: SaduDiamondProps) {
  const px = Math.min(14, Math.max(6, size));
  return (
    <svg
      viewBox="0 0 7 7"
      width={px}
      height={px}
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
      className={cn("inline-block shrink-0 align-middle", className)}
      data-sadu-diamond=""
    >
      <path d={solid ? STEPPED : `${STEPPED}${EYE}`} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
