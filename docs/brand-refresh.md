# Brand refresh: after watercolor

Status: **exploration, nothing decided.** October 2026.

The owner is no longer sure about the watercolor look and pointed at six contemporary
Arabic brand identities on Behance as the direction they like:
[SAMT](https://www.behance.net/gallery/255589313/SAMT-Visual-Identity),
[Aioshah Shawarma](https://www.behance.net/gallery/252956765/Aioshah-Shawarma),
[Ajdadi](https://www.behance.net/gallery/250836265/Ajdadi-Brand-Identity),
[Thmanyah](https://www.behance.net/gallery/192657457/Thmanyah),
[NAJD](https://www.behance.net/gallery/251102655/NAJD-Branding) and
[BADEE3](https://www.behance.net/gallery/249386305/BADEE3-BRANDING-2026).
The brief: move toward that kind of branding **without losing the identity**.

This document records what we know about the references, what the current
system is made of, three candidate directions, how to preview them in the
real app, and the order a migration would go in. The mockups for all three
directions are on a separate design canvas, linked from the PR.

## What the references have in common

A caveat first. Behance blocks automated access, so the projects were researched
through open sources rather than read directly. **Only Thmanyah is documented
outside Behance.** For the other five we know the title and category and
nothing else. NAJD is very probably a Saudi men's shawl (shemagh) brand, and
Aioshah is a shawarma restaurant with packaging. Treat anything said about
those five beyond that as inference, and add screenshots here if a decision
comes to depend on them.

**Thmanyah** (Saudi podcast and documentary network). The identity is by Milk
Network, with the Arabic logotype refined by Wael Morcos
([case study](https://milknetwork.com/work/thmanyah/)):

- **Mark.** A single Arabic numeral, ٨ ("eight"), drawn as a solid shape. The
  wordmark is a heavy **Naskh-style** ثمانية set beside a high-contrast serif
  `thmanyah`.
- **Type.** Thmanyah's own families: Serif Display, Serif Text and Sans
  ([font.thmanyah.com](https://font.thmanyah.com/)). The serifs are deliberately
  calligraphic, and the Sans has no contrast. All three are free for commercial
  use, including apps, but they are **not OFL**: they cannot be redistributed or
  modified. Using them would also make Hikaya look like Thmanyah.
- **Colour.** A black and warm off-white core, two main accents (a blue and a
  red), and a wide secondary set, all used as flat tiles.
- **Signature devices.**
  - *Highlighted text*: headline words set on solid highlighter bars.
  - Huge numerals.
  - A strict type scale.
  - Flat, slightly retro illustration and duotone photography.

The reasonable reading of the whole set, verified for Thmanyah and consistent
with the categories of the rest:

1. **The Arabic word is the logo.** The letterform is the hero, not a picture.
2. **Calligraphic roots, modern drawing.** A Naskh- or Kufi-flavoured display
   face, paired with a quiet sans for interface text.
3. **Flat solid colour fields.** No textures and no gradients. A small core
   palette and a disciplined accent set.
4. **Heritage geometry used sparingly.** Sadu weave, Najdi triangular parapets
   and stitch lines appear as edges, dividers and badges, never as wallpaper.
5. **Sticker and badge systems,** in the street-food references.

## What the current system is made of

The full inventory is in the PR. These are the parts a refresh has to deal with:

| Area | Where | Notes |
|---|---|---|
| Mark | `src/assets/hakiya-mark.png`, `hakiya-lockup.webp`, `hakiya-logo.png`, `public/*icon*`, `og-image.jpg` | **Rasters only, no vector master.** A bubble with a sadu fill, a waveform, and a calligraphic حكاية. |
| Page backdrop | `src/assets/border-full-page.webp` via `components/layout/AppBackdrop.tsx` | A painted sand field with a painted sadu band. `--sadu-band-height` in `index.css` sizes page offsets to the painting. |
| Watercolor illustration | `src/assets/illustrations/` (44 files) | Skills (4), dialects (3), empty states (6), stages (5), landing values (3), onboarding levels and goals, MSA-bridge shores (2). The badges are already flat sadu emblems. |
| Video loops | `public/assets/campfire-hero.*`, `caravan-hero.*` | Played by `LoopingMedallion`. `loading-emblem` is already flat. |
| Generated art | `scripts/generate-illustrations.mjs` (`STYLE`), `supabase/functions/generate-story-cover/index.ts` | **Both prompts say "storybook watercolor".** Story covers are generated per story, so new watercolor keeps arriving until this prompt changes. |
| Tokens | `src/index.css` `:root` / `.dark` | Desert Red #8C4135, Warm Sand #E2C5A6, Charcoal #323A36, plum. Deep Desert green #44663D is named in the palette but appears only as `success`. |
| Type | `index.html` fonts, `tailwind.config.ts` `fontFamily`, `index.css` h1–h4 | Montserrat, Open Sans, Noto Sans Arabic and Noto Naskh Arabic. No distinctive display face. |
| Hardcoded colour | `Feed.tsx`, `MsaBridge.tsx`, `MajlisPattern.tsx`, `SectionFrame.tsx`, `main.tsx`, the `sadu-*.svg` assets | Has to move to tokens before a palette change can be complete. |

## Keep, retire

- **Keep:**
  - The bubble, the waveform and حكاية as the mark.
  - Desert red as the hero colour, and the sand family as ground.
  - Sadu geometry, rebuilt as crisp vector.
  - Warmth, with Arabic leading the page.
- **Retire:**
  - Watercolor washes and paper grain.
  - Painted scenes.
  - The mottled sand page.
  - Soft drop shadows.
  - The cream-card-on-sand sameness.
  - Montserrat and Open Sans.

## Three directions

All three keep the mark's idea. They differ in how far they move from today.

### A. Weave (نسيج): the closest evolution

Today's palette and sadu, rebuilt flat and precise in the spirit of heritage-modern
identities like NAJD and SAMT.

- **Colour:**
  - Ground: sand #EEDFCB. Surface: cream #FBF6EE. Ink: #24201D.
  - Desert Red #8C4135 stays the hero.
  - Deep Desert green #44663D finally becomes a real second colour.
  - Saffron #D9A441 for highlights.
- **Type:** Reem Kufi for Arabic display, Alexandria for Latin headings, IBM Plex
  Sans Arabic for UI and reading.
- **Devices:**
  - A modular vector sadu band replaces the painted one.
  - Najdi parapet "teeth" as edges.
  - Skill tiles become solid colour blocks with flat geometric illustrations.
- **Cost:** the lowest. The palette and tokens barely move. Most of the work is
  illustration and the mark.

### B. Ink (حبر): editorial and audio-first

In the spirit of Thmanyah: paper, black ink and a single red. Huge Naskh Arabic
display type does the work that illustration does today.

- **Colour:** paper #F3EEE6, ink #121212, Signal Red #B23A27, sand #D9C4A3.
- **Type:** Noto Naskh Arabic (or Amiri) for Arabic display and learner text,
  Readex Pro for Latin and UI, IBM Plex Mono for numerals.
- **Devices:**
  - The logo's **waveform** becomes the graphic system: scrubbers, progress,
    dividers and skill tiles.
  - **Highlighter bars** mark the dialect word, the word just heard, or the
    active task.
  - Big numerals.
  - No illustration.
- **Cost:** medium. The look changes the most, but it needs the least art: the
  44 illustrations are removed rather than redrawn.

### C. Souq (سوق): playful and loud

In the spirit of street-food identities: saturated flat colour, chunky rounded
Arabic display type, a sticker system, thick ink outlines with hard offset
shadows, and bold outlined cartoon objects.

- **Colour:** cream #FFF3DF, ink #1E1A17, terracotta #B8432A, saffron #F4B740,
  palm green #2E6A4E, plum #5B2C45, rose #F3B4A6.
- **Type:** Lalezar for display, Baloo Bhaijaan 2 for UI.
- **Cost:** the highest. It needs a full illustration set in the new style, and
  the component styling changes everywhere (borders, shadows, radii).
- **Option:** works well as a *sub-brand* for games, battles, streaks and
  rewards, even if the core app goes another way.

### Mixing them

The directions share the mark and the sand-and-red family, so they can be
combined. The likeliest strong combination is **Weave's palette and sadu with
Ink's typography**: Naskh display for Arabic, highlighter bars for dialect
words, big numerals. That keeps the most identity and captures what the
verified reference does best. Souq's stickers could then be held back for
gamification.

## Previewing a direction in the real app

Append `?brand=weave`, `?brand=ink` or `?brand=souq` to any URL, including a
deploy preview. The choice is remembered on that device, and a small switcher
appears to flip between directions. `?brand=off` returns to the current look.

The preview swaps tokens, fonts, radius, shadows and the page backdrop. It does
**not** redraw the logo, the illustrations or the video loops; the mockups cover
those. People who don't opt in see no change.

## Migration plan

Each phase ships on its own and leaves the app coherent.

1. **Decide.** Pick a direction, or a mix, from the mockups and the in-app preview.
2. **Foundations: tokens and type.**
   - Move the chosen tokens into `index.css` `:root` and `.dark`.
   - Replace the Google Fonts set in `index.html`.
   - Route `tailwind.config.ts` font families through CSS variables.
   - Retune `--radius` and the shadow tokens.
   - Clear the hardcoded hex hot spots listed above.
   - Guarded by `e2e/contrast.spec.ts`, which checks WCAG AA in both themes on
     `/today`, `/choose`, `/me`, `/my-words`, `/curriculum` and `/settings`.
3. **Retire the painted backdrop.**
   - `AppBackdrop` draws a flat ground plus a vector band component.
   - `--sadu-band-height` becomes a fixed length rather than a function of the
     painting's scale.
   - Re-check the `.dark .app-backdrop` rules.
   - Delete `border-full-page.webp`.
4. **Vectorise the mark.**
   - Commission or draw an SVG master. **Draw حكاية as lettering rather than
     setting it in a font**, so the logotype is ownable.
   - Regenerate the favicon, app icons, `og-image.jpg` and the manifest and
     `theme-color` values.
   - Update `BrandMark`, `LandingHero`, `Auth`, `Onboarding` and `SaduMark`.
   - Tests that pin the current art: `SaduMark.test.tsx`, `e2e/shell.spec.ts`
     (`sadu-frame`), and the `sadu-frame.svg` expectation in
     `src/test/brandSpelling.test.ts`.
5. **Illustration system.**
   - Change `STYLE` in `scripts/generate-illustrations.mjs` and the story-cover
     prompt **first**, so new content stops arriving in watercolor.
   - Regenerate or replace the 44 files (Ink removes most of them instead).
   - Replace the campfire and caravan loops.
   - Decide whether existing story covers are regenerated or left as they are.
6. **Components.**
   - Choose tiles (`src/lib/surfaces.ts`).
   - The `MajlisWelcome` plum panel.
   - `SaduBubble`, `AskAiFab` and `SaduPlayButton` art, and the preset avatars
     in `public/avatars/`.
7. **Clean up.**
   - Remove unused watercolor code: `SectionFrame`,
     `public/assets/lahja-watercolor-bg-subtle.svg`, and `SaduBanner` and
     `MajlisPattern` if they are still unused.
   - Remove the preview switch once a direction ships.

## Open questions for the owner

- Which direction, or which mix?
- Should the logotype be redrawn by a type designer? This is recommended: the
  current calligraphy exists only as a raster.
- Should Souq become a gamification sub-brand regardless of the main direction?
- Should existing generated story covers be regenerated in the new style?
