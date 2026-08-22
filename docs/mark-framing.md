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

Everywhere the mark stands on its own:

| Surface | Variant | Size |
|---|---|---|
| `BrandMark` — the top-left lockup | `clear` | 32px |
| `ProfileEmblem` fallback | `sand` | fills the 40px slot |
| `Auth` | `clear` | 64px |
| Admin dashboard / login / stories / story form | `clear` | 32–56px |

The rule is the ground behind it. `clear` on the app's own light chrome, where
a sand disc would be a second and slightly wrong shade; `sand` on the emblem,
because that slot rides the feed's action rail over video as well as sitting in
light headers, and `sand` is the one that holds on both.

`BrandMark` takes `clear` and keeps its plate. An earlier note here said the
frame could delete that plate, and then that `BrandMark` should be left alone
entirely — both were wrong. The plate serves the wordmark as much as the mark
so it cannot go, and that is exactly the case `clear` is for: the plate becomes
the frame's floor. The mark stays 32px there rather than growing to fill the
frame, because the plate settling this lockup at 40px to match the emblem
opposite it is worth more than the few pixels the band costs.

The stacked lockup (`hakiya-logo.png` on the landing hero, onboarding and the
learn header) is untouched. That file bakes the wordmark into the artwork, so
framing it means rebuilding the lockup as a framed mark plus live text — a
different change, and a bigger one.

## The reference art

`docs/branding/mark-frames/` holds all six at 512px with alpha. 3 and 4 are
rendered from the shipped vector, so they match what the app draws; 1, 2, 5 and
6 are the raster explorations and stay that way.


## The lockup you supplied, framed

`src/assets/hakiya-lockup.webp` — your own logo file (mark, Arabic and English
already stacked) cropped to its artwork and set into a rounded-square plate with
a thin crimson rule.

Two things were done to the source and nothing else: the AI sparkle artefact in
its lower right was dropped by cropping to the artwork's real bounding box, and
the artwork's own peach ground (#F5DCC6) was kept as the plate's fill rather
than keyed out. That second choice is why there is no halo — nothing was
composited, so there is no edge to get wrong. It also means the plate sits a
shade warmer than the app's sand, which reads as a deliberate plate rather than
a mismatch.

Wired where there is room to draw it at a size all three elements survive:

| Surface | Size |
|---|---|
| `LandingHero` | 128px, 160 from `sm` |
| `Onboarding` welcome | 160px |
| `Auth` | 128px |

`Learn`'s header slot is 32px, which no lockup can serve, so it takes the
mark-only `SaduMark` instead — as does `BrandMark` and the profile emblem. That
split is the same one recorded in `docs/play-button-directions.md`: a full
lockup where there is room, a reduced form where there is not.


## The surfaces that were still showing the old artwork

Three, and they were the visible ones. Recorded here because the pattern
repeated: each round wired the new artwork somewhere real and left the place
the user actually looks unchanged.

- **`public/favicon.png`** — the browser tab, the apple-touch icon, and *both*
  PWA manifest icons all pointed at one 256px file of the bare mark. On an
  installed phone that file is the app icon.
- **`public/og-image.jpg`** — the share card, with the old lockup composited
  into its top left.
- **`BrandMark`** — the corner of every main screen, still assembling a plate,
  a mark and a wordmark by hand.

All three now use `hakiya-lockup.webp`.

### The icon set

`favicon.png` keeps the rounded plate with transparent corners, which is what a
browser tab wants. Everything else is opaque, because iOS composites an
apple-touch icon on black and Android crops a maskable one:

| File | Size | Inset | Purpose |
|---|---|---|---|
| `favicon.png` | 256 | — | tab |
| `apple-touch-icon.png` | 180 | 6% | iOS home screen |
| `icon-192.png`, `icon-512.png` | 192 / 512 | 5% | manifest `any` |
| `icon-maskable-512.png` | 512 | 19% | manifest `maskable` |

The maskable inset is the real one: Android crops that icon to a circle, so
without a safe zone it would eat the plate's corners and its crimson rule.

### The corner

`BrandMark` is now the lockup and nothing else. Its CSS plate, its ring, its
backdrop-blur and the wordmark set beside it all existed because the artwork
had neither a ground nor the English in it. It has both, so they went.

48px rather than 40. The artwork is square and carries three things instead of
one, and below roughly this size the English inside it stops resolving.
