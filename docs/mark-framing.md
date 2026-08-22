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

## Built: 4 primary, 3 kept

Both ship as vector. `src/assets/sadu-frame-sand.svg` (option 4) and
`src/assets/sadu-frame.svg` (option 3) are the band alone, traced from the
render with `potrace` — 38 KB each, 15 KB gzipped. `src/components/brand/SaduMark.tsx`
composites `hakiya-mark.png` into whichever frame is asked for:

```tsx
<SaduMark />                  // sand — the default
<SaduMark variant="clear" />  // open middle, for light surfaces
```

**The mark is not baked into either frame.** The frames carry only the band, so
the logo keeps one source of truth on disk: clean the mark up later and both
variants follow. `SaduMark.test.tsx` fails if a frame ever grows an `<image>`.

`sand` is the default because `clear` is the one that fails on a dark surface —
the mark's outline is near-black and needs something light to be dark against.
Defaulting to `clear` would put the broken case in every slot that forgets the
prop. Reach for `clear` where the surface behind is already light and a sand
disc would read as a second, slightly-wrong shade: the app's own sand pages, or
over pale artwork.

The band's inner edge is at r=23.393 of a 64 viewBox — a 73% opening — and the
mark is set at 62% of the box. Nothing in the type system connects those two
numbers, so a test does; crowding the band is what makes a framed mark look
like a sticker.

### Where it is wired

`ProfileEmblem`'s fallback, and only there for now. That slot is a round hole
that previously took the bare mark with padding, a background and a ring —
three CSS properties standing in for the plate the artwork did not have. All
three are gone.

**Not `BrandMark`**, deliberately, and the earlier note in this file suggesting
otherwise was wrong. That lockup's plate is there for the *wordmark* as much as
the mark, so it cannot be deleted by framing the mark; and a framed mark inside
a plated lockup is a ground sitting on a ground. The frame earns its place
where the mark stands alone in a round slot.

The four admin pages that use `hakiya-mark.png` as a small icon are untouched.

## The reference art

`docs/branding/mark-frames/` holds all six at 512px with alpha. 3 and 4 are
rendered from the shipped vector, so they match what the app draws; 1, 2, 5 and
6 are the raster explorations and stay that way.
