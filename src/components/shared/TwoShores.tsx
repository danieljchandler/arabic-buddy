import { cn } from "@/lib/utils";
import shoreLeftArt from "@/assets/illustrations/shore-left.webp";
import shoreRightArt from "@/assets/illustrations/shore-right.webp";

/**
 * Two painted coasts with water between them, anchored to the bottom corners
 * of whatever box it is dropped into.
 *
 * It exists for the pages built on a crossing: MSA on one shore and spoken
 * dialect on the other, or one dialect and another. The art is doing the
 * argument that the copy above it would otherwise have to make twice — there
 * are two sides, they are not the same place, and the page is the way across.
 *
 * Decoration, so the whole thing is `aria-hidden` and carries no text: the
 * shores say nothing a screen reader could use that the heading beside them
 * doesn't already say better. Anything a reader actually needs belongs in the
 * copy, not in here.
 *
 * It positions itself absolutely, so the parent needs `relative` and
 * `overflow-hidden`, plus enough bottom padding to keep its own text clear of
 * the band (`height` tells you how much — they are the same number).
 *
 * The paper the shores were painted on was keyed out
 * (scripts/cutout-art.mjs), so they carry no background of their own and sit
 * on whatever the parent is. That works on the warm creams and sands the app
 * is built from; on a saturated or dark panel the watercolour would read as
 * washed-out and this is the wrong ornament for it.
 */
export interface TwoShoresProps {
  /**
   * Height of the band, as Tailwind classes. Tuned per site rather than fixed
   * here: a page header wants a shallow strip, a full-width splash wants room
   * for the towers on the right shore to actually be legible.
   */
  height?: string;
  /**
   * Draw the dashed crossing between the two shores. On by default — it is the
   * half of the picture that says the strait is passable rather than just
   * wide. Turn it off where the gap is carrying something else.
   */
  crossing?: boolean;
  className?: string;
}

export function TwoShores({
  height = "h-28 sm:h-36",
  crossing = true,
  className,
}: TwoShoresProps) {
  return (
    <div
      aria-hidden
      data-testid="two-shores"
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 select-none",
        height,
        className,
      )}
    >
      {/* The water. A wash rather than a band of colour: the shores fade into
          paper at their own waterline, so a hard-edged sea would sit in front
          of the place they end and cut them off. */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-primary/[0.09] to-transparent" />

      {/*
        The crossing, drawn to the box rather than to the art: a flat arc from
        one shoulder to the other. `vectorEffect` keeps the dashes the same
        weight however the viewBox is stretched, which it always is — the
        header this sits in is 400px wide on a phone and 1000px on a desktop.
      */}
      {crossing && (
        <svg
          className="absolute inset-x-0 bottom-[38%] h-[42%] w-full overflow-visible text-plum/55"
          viewBox="0 0 100 20"
          preserveAspectRatio="none"
          focusable="false"
        >
          <path
            d="M 22 16 Q 50 2 78 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="3 3"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}

      {/* Right shore first so the left one overlaps it where they meet on a
          narrow screen: the left shore's long sandspit is the tapered edge,
          and a taper crossing a cliff reads as distance, where the reverse
          reads as a mistake. */}
      {/*
        Sized by height, not by width. Width-sized art is a trap here: the
        images are wider than they are tall, so on a wide container a
        percentage width makes them tall enough to climb out of the band and
        wash over the copy above — which is exactly what the first cut of this
        did to the bridge page's second paragraph. `max-w` is the guard for the
        other end, and it is doing real work: without it, height-sizing closes
        the strait entirely on a phone, where the container is short and narrow
        and the left shore's sandspit runs straight into the right headland.
        The two clamps leave a sixth of the width as open water at every size.
      */}
      <img
        src={shoreRightArt}
        alt=""
        loading="lazy"
        draggable={false}
        className="absolute bottom-0 right-0 h-full w-auto max-w-[40%] object-contain object-bottom"
      />
      <img
        src={shoreLeftArt}
        alt=""
        loading="lazy"
        draggable={false}
        className="absolute bottom-0 left-0 h-full w-auto max-w-[44%] object-contain object-bottom"
      />
    </div>
  );
}
