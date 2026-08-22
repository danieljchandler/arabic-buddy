# Framing the mark, without filling in behind it

The cleanup pass on the logo came back as opaque rasters on white. The original
`hakiya-icon.png` has real alpha — 83% of it is transparent — and losing that
was the thing worth rejecting, not the cleanup itself.

These six put a frame around the mark and keep the file clear outside it.
512px WebP with alpha in `docs/branding/mark-frames/`.

Comparison, on white / near-black / sand / the page's own sadu border, at
96&nbsp;px down to 32:
<https://claude.ai/code/artifact/2a5d6b50-6689-44e3-8de4-c0ce1df37fd0>

## The mark is not regenerated

Every one of these is the **original mark composited into a new frame**, not a
model's redraw of it. Frames 1, 2, 5 and 6 are drawn geometry; the sadu band in
3 and 4 is lifted out of a generated render as a clean annulus, keyed on colour
as well as radius so the render's own bubble tail does not bleed into the band.

An earlier round asked the model to add the frame to the mark directly. Four of
six drifted: one returned a broken ring, one recoloured the whole mark, two
enlarged and reshaped the Arabic. Compositing removes that whole class of
failure.

## What the exercise actually found

**A frame alone does not fix legibility.** The bubble outline and the tail are
near-black, so on a dark ground the mark stops having an edge — the weave still
reads, but the silhouette bleeds into the background and by 32&nbsp;px it is a
smudge. A ring drawn around that does not bring the edge back.

**A frame with a light interior does fix it**, and still leaves the file clear
outside the frame, which is what "clear behind" means in practice.

So the six split in two:

| | Frame | Inside | Holds on dark |
|---|---|---|---|
| 1 | Hairline ring | clear | no |
| 3 | Sadu band | clear | frame yes, mark no |
| 6 | Double keyline | clear | frame yes, mark no |
| 2 | Sand roundel | sand + crimson rule | yes |
| 4 | Sadu band on sand | sand | yes |
| 5 | App tile (squircle) | sand + ink rule | yes |

## Recommendation

**4, sadu band on sand.** It keeps the file clear outside the frame, it holds on
every ground the app uses, and it is the only one that is also *of* this app —
the same woven band as `border-full-page.webp` and the traced play button, so
the mark stops being the one piece of the identity that does not reference the
cloth. **2** is the restrained version of the same idea and the safer favicon.

## What a framed mark would let us delete

`src/components/shell/BrandMark.tsx` draws its own plate in CSS
(`bg-background/85`, a ring, a backdrop-blur) and its comment says why: the mark
has a transparent ground and an open silhouette, so on the chooser it landed on
the page's sadu border and pattern showed through pattern. A framed mark carries
that plate in the artwork instead, at every size and on every surface.

Before any of this ships, the sadu band in 3 and 4 wants the treatment the play
button got — traced to vector rather than shipped as a raster — for the same
reason recorded in `docs/play-button-directions.md`: a woven band stops
resolving as raster below about 32px, and the mark renders at 32.
