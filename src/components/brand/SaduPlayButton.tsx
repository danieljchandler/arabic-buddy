import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The play control, cut out of a piece of Sadu cloth.
 *
 * This started as a woven band around an open centre. The ring is gone: the
 * pattern belongs on the button, not drawn around a hole in the middle of one.
 * So the disc *is* the cloth — the weave runs edge to edge in a plain repeat
 * and the circle simply crops it, the way a round cut out of the banner would.
 *
 * The one thing the ring did get right survives, moved: the play glyph is a
 * hole knocked clean through the cloth, so the frame behind still shows through
 * the control. It shows through the triangle instead of through the centre,
 * which reads as a control over someone's video rather than a badge covering
 * it. That is why the disc is painted through a clip of "circle minus triangle"
 * rather than painted solid with a cream triangle laid on top; the difference
 * is invisible on a still and obvious the moment the clip is playing.
 *
 * The palette comes off `assets/sadu-banner.webp` rather than being picked by
 * eye, because this sits a few hundred pixels from that same banner on other
 * routes and any drift between the two reads as a mistake. Hardcoded hex, like
 * the rest of the feed's on-media chrome: these are the artwork's colours and
 * they do not follow the light/dark theme — the button always sits on video.
 *
 * The motif is `public/assets/sadu-tile.svg`'s — a lattice of lozenges, each
 * cell holding a filled lozenge with a contrasting core, small ones on the
 * crossings between — so the app has one sadu vocabulary rather than a second
 * one invented here.
 */

/**
 * The banner's own two colours: its ground measures #75101A and its weft
 * #FAE7C7. The cream is used as-is; the crimson is lifted a few points, because
 * the banner sits on sand and this sits on video, where the darker value went
 * muddy against a dim frame instead of reading as red.
 */
const CRIMSON = "#8A1520";
const CREAM = "#FAE7C7";

/**
 * A twenty-unit repeat, which is a deliberate choice and not a round number.
 * The feed renders this at 64px, so a unit is about a pixel: at 20 the lozenges
 * land near 9px across and the lattice reads as cloth, while the 8-unit repeat
 * this motif uses on the banner turns to noise at that size. `SaduBubble`
 * records the same floor from the other side — a woven band stops resolving
 * under roughly 32px — and 20 is what keeps a diamond-lattice-diamond rhythm
 * legible down to about 40px, smaller than anything currently renders it.
 */
const TILE = 20;
/**
 * Nudge the repeat so a cell centre lands exactly on the disc centre. Without
 * this the tiling is off-phase against a circle whose centre (32) is not a
 * multiple of 20, and the field sits visibly heavier on one side.
 */
const PHASE = (32 % TILE) - TILE / 2;

/** The lozenge in each cell, its core, and the small ones on the crossings. */
const LOZENGE = 4.3;
const CORE = 1.8;
const CROSSING = 2.3;

/** The disc, as a circle of the same radius the band used to reach. */
const DISC = "M0.6 32A31.4 31.4 0 1 0 63.4 32A31.4 31.4 0 1 0 0.6 32Z";
/**
 * The glyph. Its centroid sits at x=32 rather than its bounding box, which is
 * why the numbers look lopsided — a triangle centred by its box reads as
 * shifted left.
 */
const GLYPH = "M25.6 21.6L44.8 32L25.6 42.4Z";

const diamond = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`;

/** The four half-lozenges that meet across a tile boundary to make one whole. */
const CROSSINGS = [
  [0, 0],
  [TILE, 0],
  [0, TILE],
  [TILE, TILE],
]
  .map(([x, y]) => diamond(x, y, CROSSING))
  .join("");

/** The lattice itself: corner to corner through the tile's edge midpoints. */
const LATTICE = `M0 ${TILE / 2}L${TILE / 2} 0L${TILE} ${TILE / 2}L${TILE / 2} ${TILE}Z`;

export interface SaduPlayButtonProps {
  /** Sizing lives here — the art is a viewBox and fills whatever it is given. */
  className?: string;
}

export function SaduPlayButton({ className }: SaduPlayButtonProps) {
  // The feed renders one of these per card, so the ids cannot be constants —
  // duplicate ids in a document make every button after the first depend on
  // whether the first is still mounted.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const weave = `sadu-weave-${uid}`;
  const cloth = `sadu-cloth-${uid}`;

  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("rounded-full", className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern
          id={weave}
          width={TILE}
          height={TILE}
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(${PHASE} ${PHASE})`}
        >
          <rect width={TILE} height={TILE} fill={CRIMSON} />
          <path d={CROSSINGS} fill={CREAM} />
          <path d={LATTICE} fill="none" stroke={CREAM} strokeWidth="1.3" />
          <path d={diamond(TILE / 2, TILE / 2, LOZENGE)} fill={CREAM} />
          <path d={diamond(TILE / 2, TILE / 2, CORE)} fill={CRIMSON} />
        </pattern>

        {/* Circle minus triangle, under evenodd — the cloth with the glyph
            already missing from it, so nothing is ever painted there. */}
        <clipPath id={cloth}>
          <path d={`${DISC}${GLYPH}`} clipRule="evenodd" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${cloth})`}>
        <rect width="64" height="64" fill={`url(#${weave})`} />

        {/* A crimson moat around the cut. Without it the glyph is a hole in a
            busy field, and over a bright frame the hole fills with something
            close to the cream in the weave and stops reading as a triangle at
            all. Half of this stroke falls inside the clip and is discarded;
            what is left is a plain border of ground colour around the glyph,
            which is also what a woven edge actually looks like when it is
            bound. Do not "simplify" this away — it looks redundant on a dark
            still and is the whole reason the button survives daylight. */}
        <path
          d={GLYPH}
          fill="none"
          stroke={CRIMSON}
          strokeWidth="4.6"
          strokeLinejoin="round"
        />

        {/* The rule the weave is worked between, as on the banner. It also
            separates the disc from a pale frame, where crimson-on-sand alone
            left the edge soft. */}
        <circle cx="32" cy="32" r="30.8" fill="none" stroke={CREAM} strokeWidth="1.1" />
      </g>

      {/* The cut edge, drawn outside the clip so it survives at the boundary. */}
      <path
        d={GLYPH}
        fill="none"
        stroke={CREAM}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
