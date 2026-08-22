# Play button: six directions with the pattern on the disc

The feed's play control currently wears sadu as a *ring* — a woven band around
an open centre (`src/components/brand/SaduPlayButton.tsx`). The ring is out.
What follows is six ways to put the pattern on the button face itself, kept
here so the reasoning survives the decision.

Concepts were rendered with Gemini (`gemini-3-pro-image`) conditioned on
`src/assets/sadu-banner.webp`, so the motif vocabulary and the two colours come
off the app's own artwork rather than being invented. **They are direction, not
artwork** — whichever wins gets redrawn as vector against
`public/assets/sadu-tile.svg` before it ships.

Renders live in `docs/branding/play-button/`, two per option: `-dim` is a night
frame, `-bright` is an overexposed daylight frame. The bright one is the real
test — on-media chrome that only works over dark video is chrome that breaks
on half the feed.

Interactive comparison, with each option shown at 64&nbsp;px and 44&nbsp;px:
<https://claude.ai/code/artifact/257995a6-4fb3-47f2-9152-f0e47984983e>

## The constraint that decides this

The feed renders the control at 64&nbsp;px (`h-16 w-16` in `src/pages/Feed.tsx`).
`SaduBubble` already records where a woven band stops resolving — roughly
32&nbsp;px — and the current button's own note puts a legible diamond–cross
rhythm at about 40&nbsp;px with eight repeats. So the question for every option
below is not "is it beautiful at 1024&nbsp;px" but "what is left of it at 64".

| # | Direction | Pattern lives | Build | Holds at 64px |
|---|-----------|---------------|-------|---------------|
| 01 | Cut from the cloth | whole face, glyph knocked through | pattern tile + evenodd punch | needs a redraw at ~2× scale |
| 02 | Loom bands | horizontal bands | banded clip | yes |
| 03 | The weave is in the glyph | inside the triangle | clipped glyph | as texture only |
| 04 | Star medallion | radiating from centre | placed geometry | no |
| 05 | Diagonal twill | one half, on a seam | split clip | yes |
| 06 | Pressed weave | tone-on-tone across the face | pattern tile | yes |

## The six

**01 — Cut from the cloth.** The disc *is* a piece of sadu; the circle just
crops the weave. The play glyph is a hole knocked through the cloth, so the
clip shows through the triangle. This keeps the one genuinely good property of
the ring (the video shows through the control) and moves it into the glyph.
Loudest of the six; the motif needs roughly 2× scaling and the hairline rules
dropped before it survives 64&nbsp;px.

**02 — Loom bands.** How a sadu strip is actually woven: narrow bands stacked,
each with its own motif, cream rules between. Horizontal rhythm survives
downscaling in a way an all-over field does not — you lose the lozenges and
still read cloth. Vector lets the stack thin as the size drops (five bands at
96&nbsp;px, three at 64, one at 40).

**03 — The weave is in the glyph.** Plain smoked-glass disc with a cream
hairline; all the pattern inside the triangle. Smallest diff from the current
component. At 64&nbsp;px the triangle is ~20&nbsp;px wide, so the weave lands as
texture rather than motif.

**04 — Star medallion.** The eight-point sadu star as a badge, glyph in a
centre roundel. Structurally what the component already does (eight rotated
groups), moved inward. The radiating threads collapse first, and a centred
medallion with a small glyph reads as a mark stamped on somebody's video rather
than a control — which is the real objection, not the size.

**05 — Diagonal twill.** One seam: solid crimson below, twill above, a cream
rule between, running the same way the triangle points. The solid half
guarantees a clean ground behind the glyph on any frame. The asymmetry is the
risk — it needs a fixed angle everywhere or it starts reading as a mistake.

**06 — Pressed weave.** Near-black glass with the weave pressed in tone on
tone, one crimson hairline at the rim doing the brand work. The scrim and the
ornament become the same layer, so nothing extra sits over the video. Closest
to ordinary video chrome while still not stock.

## Three ways to build whichever wins

- **A tiled SVG pattern** — one motif in `<pattern>`, clipped to a circle.
  About a kilobyte, crisp at any density, and the motif stays the same object
  as `sadu-tile.svg`. Right for 01, 02, 03, 06.
- **Explicit geometry** — every lozenge placed by hand, the way the current
  component rotates eight groups. More code, but the only approach where you
  control exactly what survives at 40&nbsp;px. Right for 04 and 05.
- **A raster asset** — richest art, like `SaduBubble`'s four PNGs. Rejected:
  that component's own note puts the floor for a legible woven band at about
  32&nbsp;px, and this control renders at 64, so there is no headroom.

## Recommendation

02 (Loom bands) is the only one that reads as woven cloth at 64&nbsp;px with no
redraw. 01 is the better object and the more interesting idea, and worth the
redraw if the show-through matters. 06 is the fallback if the feed ever feels
busy. 04 is the one to argue against.

## Reproducing the renders

The generator is not checked in — it was a one-off against a personal Google AI
Studio key, and nothing in the app calls image generation. If it needs
repeating: `gemini-3-pro-image` via `generativelanguage.googleapis.com`, with
`sadu-banner.webp` passed inline as the first part and the direction described
in the text part. The bright variants were made image-to-image from the dim
ones ("keep the button identical, change only the backdrop"), which is what
keeps the pair comparable.
