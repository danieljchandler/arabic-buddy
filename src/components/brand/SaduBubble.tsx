import { useId, type CSSProperties } from "react";

/**
 * A speech bubble carrying a band of Sadu weave.
 *
 * This is the Hakiya mark's own idea, generalised: the logo is a speech bubble
 * with a Sadu ring, and the brand film draws every line of dialogue as a bubble
 * filled with woven pattern rather than words. Speech that looks like cloth is
 * a more particular thing for a language app to own than a sparkle.
 *
 * Two rules carry the look, and both are worth keeping if anything else here
 * changes. The weave is always the fill darkened, never a contrasting colour —
 * tone-on-tone is what reads as texture rather than as decoration. And the
 * motif is coarse: a handful of large diamonds, not a fine mesh, because a fine
 * mesh turns to grey mush the moment the bubble is smaller than a thumbnail.
 */

/** Full band — triangle rows above and below a diamond lattice. */
function WeaveFull({ id, ink }: { id: string; ink: string }) {
  return (
    <pattern id={id} width="25" height="36" patternUnits="userSpaceOnUse">
      <path d="M0.5,8 L6.25,0.5 L12,8 Z M13,8 L18.75,0.5 L24.5,8 Z" fill={ink} />
      <rect y="10" width="25" height="1.6" fill={ink} />
      <path d="M12.5,14 L20,25 L12.5,36 L5,25 Z" fill="none" stroke={ink} strokeWidth="2.2" />
      <path d="M12.5,20 L15.6,25 L12.5,30 L9.4,25 Z" fill={ink} />
      <path d="M0,14 L3.2,25 L0,36 M25,14 L21.8,25 L25,36" fill="none" stroke={ink} strokeWidth="2.2" />
    </pattern>
  );
}

/** Small-size band — diamonds only. Triangles vanish below ~40px anyway. */
function WeaveSimple({ id, ink }: { id: string; ink: string }) {
  return (
    <pattern id={id} width="44" height="30" patternUnits="userSpaceOnUse">
      <path d="M22,1 L37,15 L22,29 L7,15 Z" fill="none" stroke={ink} strokeWidth="5" />
      <path d="M22,9 L28,15 L22,21 L16,15 Z" fill={ink} />
      <path d="M0,1 L5,15 L0,29 M44,1 L39,15 L44,29" fill="none" stroke={ink} strokeWidth="5" />
    </pattern>
  );
}

export interface SaduBubbleProps {
  /** Bubble fill. The weave is derived from it, so pass one colour, not two. */
  tint?: string;
  /** How much darker the weave sits than the fill. */
  inkOpacity?: number;
  /** Tail corner. Bubbles in the film point back at whoever is speaking. */
  tail?: "left" | "right" | "none";
  /** "simple" drops the triangle rows — use it under about 40px. */
  detail?: "full" | "simple";
  className?: string;
  title?: string;
  style?: CSSProperties;
}

const BODY = {
  none: "M18,2 H82 A16,16 0 0 1 98,18 V50 A16,16 0 0 1 82,66 H18 A16,16 0 0 1 2,50 V18 A16,16 0 0 1 18,2 Z",
  right: "M18,2 H82 A16,16 0 0 1 98,18 V50 A16,16 0 0 1 82,66 H74 L78,84 L58,66 H18 A16,16 0 0 1 2,50 V18 A16,16 0 0 1 18,2 Z",
  left: "M18,2 H82 A16,16 0 0 1 98,18 V50 A16,16 0 0 1 82,66 H42 L22,84 L26,66 H18 A16,16 0 0 1 2,50 V18 A16,16 0 0 1 18,2 Z",
} as const;

export function SaduBubble({
  tint = "currentColor",
  inkOpacity = 0.3,
  tail = "left",
  detail = "full",
  className,
  title,
  style,
}: SaduBubbleProps) {
  const uid = useId().replace(/:/g, "");
  const pid = `sw-${uid}`;
  const cid = `sc-${uid}`;
  // The band runs nearly the full width and most of the height, as in the film.
  const y = detail === "full" ? 14 : 19;
  const h = detail === "full" ? 40 : 30;

  return (
    <svg
      viewBox="0 0 100 86"
      className={className}
      style={style}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
    >
      {title && <title>{title}</title>}
      <defs>
        {detail === "full" ? <WeaveFull id={pid} ink="#000" /> : <WeaveSimple id={pid} ink="#000" />}
        <clipPath id={cid}>
          <rect x="6" y={y} width="88" height={h} rx="3" />
        </clipPath>
      </defs>

      {/* body and tail as one silhouette, so there is no seam at the join */}
      <path d={BODY[tail]} fill={tint} />

      <g clipPath={`url(#${cid})`} opacity={inkOpacity}>
        <rect x="0" y={y} width="100" height={h} fill={`url(#${pid})`} />
      </g>
    </svg>
  );
}
