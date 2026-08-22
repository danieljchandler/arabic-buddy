import art from "@/assets/sadu-play.svg";

/**
 * The play control: a disc of Sadu cloth with the glyph cut out of it.
 *
 * This started as a woven band around an open centre. The ring is gone — the
 * pattern belongs on the button, not drawn around a hole in the middle of one.
 * The disc *is* the cloth: the weave runs edge to edge and the circle simply
 * crops it, the way a round cut out of the banner would.
 *
 * The one thing the ring got right survives, moved. The play glyph is a hole
 * knocked clean through the cloth rather than a cream triangle laid on top, so
 * the frame behind still shows through the control — through the triangle now
 * instead of through the centre. That is a property of the artwork itself
 * (`assets/sadu-play.svg` clips the disc to "circle minus triangle"), not
 * something this component can lose by accident.
 *
 * The art is **traced from the render the design was chosen off**, not redrawn
 * from measurements. That is the whole point and it is worth stating plainly,
 * because the obvious-looking alternative was tried first and thrown away: a
 * hand-built `<pattern>` of lozenges, sized and simplified for 64px. It was
 * legible, it was a tenth of the size, and it did not look like the thing
 * anybody agreed to. The weave in a real sadu strip is rows of *outlined*
 * diamonds banded by rules, not a lattice of solid ones, and no amount of
 * tuning a tile got there. Tracing keeps the artwork's own geometry, including
 * the parts that are irregular because a loom is.
 *
 * An `<img>` rather than inline SVG, and for a specific reason: the feed
 * renders one of these per card. Inline, the traced path data — about 16 KB of
 * it — would sit in the DOM once per card. As an asset it is fetched once,
 * cached, and shared by every instance, and its ids are scoped to its own
 * document so nothing collides.
 *
 * The two colours come off `assets/sadu-banner.webp`, so this cannot drift from
 * the banner it sits near on other routes. They are the artwork's colours and
 * do not follow the light/dark theme — the button always sits on video.
 */

export interface SaduPlayButtonProps {
  /** Sizing lives here — the art is a viewBox and fills whatever it is given. */
  className?: string;
}

export function SaduPlayButton({ className }: SaduPlayButtonProps) {
  return (
    <img
      src={art}
      alt=""
      // Ornament inside a button that already carries "Play <title>". Anything
      // this contributed to the accessible name would be read on top of that.
      aria-hidden="true"
      className={className}
      draggable={false}
    />
  );
}
