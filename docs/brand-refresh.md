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

Behance blocks automated access, so these notes come from screenshots the owner
shared plus open sources (Milk Network's Thmanyah case study).

| Reference | What it is | What it does |
|---|---|---|
| **BADEE3** (Khiall Studio, 2026) | A cultural storytelling platform | Naskh-rooted, high-contrast display Arabic (Arsenica Arabic) with **dramatically stretched kashida**: رياضـــة, ثقافـــة. Palette: oxblood, mustard and cream, with a near-black green. Tiny corner meta-labels on every panel. Warm, sepia, cinematic photography with huge Arabic words over it. |
| **NAJD** | Boutique residential compound, "For houses carry a spirit" | Najdi triangular ventilation patterns become a **triangle pattern system** and an emblem. A sweeping calligraphic نجد. Muted forest, sage, winter green, pastel yellow and teak. Times for Latin; **IBM Plex Sans Arabic** for paragraphs. |
| **Ajdadi** | Palestinian streetwear | One vivid green with a dark green and cream. A chunky, interlaced calligraphic logotype. **Tatreez cross-stitch drawn as pixel grids**, even as lettering. |
| **Aioshah®** (JDS, Riyadh, 2025) | Shawarma brand | "This isn't heritage placed on packaging. It's heritage transformed into a branding system." A **sadu stepped-diamond emblem**, sadu label tapes, and badge-row lockups. Black, eggshell, a pure red and two evergreens. Kepler serif for Latin. |
| **SAMT** (2026) | Modern thobes and menswear | A chunky logotype, سَمْت, whose **diacritics are graphic elements**, set with a heavy old-style serif "SAMT". Coral, navy, cobalt and cream. A lattice pattern, a **circular compass seal**, and sunlit film photography. |
| **Thmanyah** (Milk Network) | Saudi podcast and media network | A Naskh-style serif display paired with a no-contrast sans. **Highlighted-text bars.** Big numerals. A black and warm off-white core with flat accent tiles. |

The shared language:

1. **The Arabic word is the logo.** It is custom, Naskh-rooted and dramatic:
   stretched kashida, and diacritics drawn as graphics.
2. **Heritage geometry turned into a system.** Sadu diamonds, Najdi triangles,
   tatreez pixels and lattices appear as emblems, bands, tapes and full-bleed
   panels, in two or three flat colours. Never as decoration.
3. **A classical serif for Latin,** and a clean sans for body text.
4. **A cream ground, one deep dark and one hot accent,** with plenty of
   full-bleed dark panels.
5. **Huge Arabic words used as images.** In the references these are often set
   over photography, but Hikaya will not use photographic imagery (see
   below).
6. **Nothing cartoonish:** no rounded app-style playfulness, no gradients.

Three things here suit Hikaya particularly well:

- Hikaya already has sadu, so Aioshah's line is the thesis: the heritage should
  become the system rather than sit on top of it.
- The stretched kashida suits a **spoken**-dialect app, because elongation is
  how speech sounds: حكـــاية.
- **The owner has ruled out photography and photo-realistic imagery.** The
  painted scenes are replaced by pattern panels, typography (the word as the
  image) and flat graphic illustration, never photos.

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

All three keep the mark's idea, with one cluster of references behind each.
Mockups for every direction are on the canvas: a brand sheet plus Today,
Choose, a word card and the landing page.

### A. Weave (نسيج): the closest evolution

Aioshah, NAJD and Ajdadi.

- **Colour:** Desert Red #8C4135 stays the hero, on a pastel sand ground
  #F2E6CF. Deep Desert green, named in today's palette but never used,
  arrives as **evergreen #1F3A2C** full-bleed panels. Sage #7D7F5F and saffron
  #D9A441 are accents.
- **Type:** Aref Ruqaa for Arabic display, Newsreader serif for Latin headings,
  IBM Plex Sans Arabic for UI and reading text.
- **Devices:**
  - A sadu stepped-diamond emblem as the secondary symbol.
  - A Najdi triangle pattern.
  - Sadu label tapes.
  - Skill tiles as solid blocks, each with its own pattern motif.
- **Cost:** the lowest. The palette barely moves. The work is the mark, the
  pattern kit, and swapping painted scenes for pattern panels and flat
  geometric illustration.

### B. Ink (حبر): editorial and audio-first

BADEE3 and Thmanyah.

- **Colour:** desert red deepens to **oxblood #6B1F1F**, with **mustard #E2B65C**
  on cream #EFE6CF and near-black #1A1C17.
- **Type:** Rakkas for Arabic display, with stretched kashida. DM Serif Display
  for Latin headlines, Readex Pro for UI, Noto Naskh Arabic for learner text.
- **Devices:**
  - The logo's waveform becomes the graphic system.
  - Highlighter bars mark the dialect word or the word just heard.
  - BADEE3-style corner meta-labels.
  - Type as the only imagery: giant cropped letterforms and a tonal texture of
    calligraphy letters.
- **Cost:** medium. The look changes most, but it needs almost no art: most of
  the 44 illustrations are removed rather than redrawn.

### C. Souq (سوق): bold and colourful

SAMT and Aioshah.

- **Colour:** coral #D4553D (deep coral #B5432F for buttons), navy #13293A,
  cobalt #2C5F8F and cream #EFE3BF.
- **Type:** Lalezar for Arabic display, with the logotype's harakat drawn as
  graphic elements. Young Serif for Latin, Alexandria for UI.
- **Devices:**
  - A lattice pattern.
  - A circular seal.
  - Label-tape lockups.
  - Flat, two-to-three-colour poster illustration in a screenprint style.
- **Cost:** medium to high. The palette moves furthest from today. Desert red
  survives only as coral, and sand as cream.

### Mixing them

The directions share the mark and the warm ground, so
they can be combined. The likeliest strong mix is **Weave's palette and sadu
system with Ink's typographic moves**: kashida display, highlighter bars for
dialect words, big numerals. That keeps the most identity and borrows what
BADEE3 and Thmanyah do best.

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
   - **Fix the vowelling.** The current raster puts a fatha on the ح
     (حَكاية), which reads *ḥakāya*: the old "Hakiya" spelling. The app is
     *Hikaya*, so the new mark should carry a kasra: حِكَايَة.
   - Regenerate the favicon, app icons, `og-image.jpg` and the manifest and
     `theme-color` values.
   - Update `BrandMark`, `LandingHero`, `Auth`, `Onboarding` and `SaduMark`.
   - Tests that pin the current art: `SaduMark.test.tsx`, `e2e/shell.spec.ts`
     (`sadu-frame`), and the `sadu-frame.svg` expectation in
     `src/test/brandSpelling.test.ts`.
5. **Illustration system.**
   - Change `STYLE` in `scripts/generate-illustrations.mjs` and the story-cover
     prompt **first**, so new content stops arriving in watercolor.
   - Replace the 44 files with pattern panels and flat graphic illustration in
     the chosen direction's palette. No photographs.
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
- Should existing generated story covers be regenerated in the new style?
