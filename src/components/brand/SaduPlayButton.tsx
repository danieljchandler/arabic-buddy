import { cn } from "@/lib/utils";

/**
 * The play control, wearing a band of Sadu weave.
 *
 * The feed's play button was a black disc with a white triangle — the same
 * control every video app ships, and the one place on the front door where
 * nothing said whose app this is. The mark is a speech bubble ringed in sadu
 * and the backdrop carries a sadu border, so the button that starts a clip
 * wears the same cloth.
 *
 * Restraint is the whole point, so the ornament is a *ring*, not a disc: the
 * centre stays open and the frame behind it shows through, exactly as it did
 * before. The red is the band alone rather than a solid red blob over
 * somebody's video, which is what keeps this readable as a control instead of
 * a badge.
 *
 * The palette comes off `assets/sadu-banner.webp` rather than being picked by
 * eye, because this sits a few hundred pixels from that same banner on other
 * routes and any drift between the two reads as a mistake. Hardcoded hex, like
 * the rest of the feed's on-media chrome: these are the artwork's colours and
 * they do not follow the light/dark theme — the button always sits on video.
 *
 * The motif itself is `public/assets/sadu-tile.svg`'s — lozenge, contrasting
 * core, crossed threads between — bent around a ring, so the app has one sadu
 * vocabulary rather than a second one invented here.
 *
 * Eight motifs, not sixteen. The band is under 7px tall at the size the feed
 * uses it, and `SaduBubble` already records where this stops working: below
 * roughly 32px a woven band stops resolving and turns to noise. Eight repeats
 * keep a legible diamond–cross–diamond rhythm down to about 40px, which is
 * smaller than anything currently renders it.
 */

/**
 * The banner's own two colours: its ground measures #75101A and its weft
 * #FAE7C7. The cream is used as-is; the crimson is lifted a few points, because
 * the banner sits on sand and this sits on video, where the darker value went
 * muddy against a dim frame instead of reading as red.
 */
const CRIMSON = "#8A1520";
const CREAM = "#FAE7C7";

/** One motif per eighth of the ring; each <g> is the same art, rotated. */
const SEGMENTS = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * The band, as two full circles in one path under `evenodd` — an annulus, so
 * the middle is genuinely transparent rather than filled and covered up.
 */
const BAND =
  "M0.6 32A31.4 31.4 0 1 0 63.4 32A31.4 31.4 0 1 0 0.6 32Z" +
  "M7.4 32A24.6 24.6 0 1 0 56.6 32A24.6 24.6 0 1 0 7.4 32Z";

/** The lozenge and its ground-coloured core — the tile's motif, bent to a ring. */
const DIAMOND = "M32 0.6L38.54 4.77L32 7.4L25.46 4.77Z";
const CORE = "M32 2.57L34.74 4.13L32 5.43L29.26 4.13Z";
/** The crossed warp threads that sit between lozenges in the weave. */
const CROSS = "M28.25 7.08L36.58 1.54M35.75 7.08L27.42 1.54";

export interface SaduPlayButtonProps {
  /** Sizing lives here — the art is a viewBox and fills whatever it is given. */
  className?: string;
}

export function SaduPlayButton({ className }: SaduPlayButtonProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("rounded-full backdrop-blur-[2px]", className)}
      aria-hidden="true"
      focusable="false"
    >
      {/* Enough scrim to hold the glyph against a bright frame, not enough to
          hide the one behind it. */}
      <circle cx="32" cy="32" r="25" fill="#120C0A" fillOpacity="0.45" />

      <path d={BAND} fill={CRIMSON} fillRule="evenodd" />
      {/* The rules the weave is worked between, as in the banner. */}
      <circle cx="32" cy="32" r="30.95" fill="none" stroke={CREAM} strokeWidth="0.9" />
      <circle cx="32" cy="32" r="25.05" fill="none" stroke={CREAM} strokeWidth="0.9" />

      {SEGMENTS.map((i) => (
        <g key={i} transform={`rotate(${i * 45} 32 32)`}>
          <path d={DIAMOND} fill={CREAM} />
          <path d={CORE} fill={CRIMSON} />
          <path
            d={CROSS}
            transform="rotate(22.5 32 32)"
            fill="none"
            stroke={CREAM}
            strokeWidth="0.85"
            strokeLinecap="round"
          />
        </g>
      ))}

      {/* Cream rather than white: the triangle belongs to the weave above it. */}
      <path d="M27.6 24.4L41.6 32L27.6 39.6Z" fill={CREAM} />
    </svg>
  );
}
