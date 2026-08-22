import art from "@/assets/sadu-play.svg";

/**
 * The play control: the Sadu weave pressed into dark glass.
 *
 * Two earlier answers are worth recording, because both were wrong in ways
 * that are easy to repeat. The first was a woven band around an open centre —
 * ornament drawn around a hole rather than on the button. The second put the
 * cloth on the whole face and cut the glyph out of it, which was beautiful and
 * was not a play button: at feed size the weave was so loud that the triangle
 * had to fight it, and a control that has to be found is a broken control.
 *
 * So the pattern went quiet. The disc is near-black glass with the weave
 * pressed into it tone on tone — two charcoals about four percent of luminance
 * apart, texture you sense rather than read — one crimson hairline at the rim
 * doing all the brand work, and a solid cream triangle that is the only bright
 * thing in the button. Ordinary video chrome does the same thing for the same
 * reason; this just does it in the app's own cloth.
 *
 * That tone-on-tone gap is the design, not an accident of the render, and it
 * is exactly what someone will "fix" on a bright monitor. `sadu-play.svg` says
 * so and the test holds it down. Widen it and this becomes printed rather than
 * pressed, which is the loud version we already rejected.
 *
 * The art is **traced from the render the design was chosen off**, not redrawn
 * from measurements — the same decision, for the same reason, as the version
 * before it: a hand-built tile was tried, was a tenth of the size, and did not
 * look like the thing anybody agreed to.
 *
 * The louder cloth is not lost. It lives at `docs/branding/sadu-cloth-disc.svg`
 * as a full disc of woven sadu with the glyph cut through it, ready for some
 * other element that wants to be loud.
 *
 * An `<img>` rather than inline SVG, and for a specific reason: the feed
 * renders one of these per card. Inline, the traced path data — about 21 KB of
 * it — would sit in the DOM once per card. As an asset it is fetched once,
 * cached, and shared by every instance, and its ids are scoped to its own
 * document so nothing collides.
 *
 * The colours are the artwork's own and do not follow the light/dark theme —
 * the button always sits on video.
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
