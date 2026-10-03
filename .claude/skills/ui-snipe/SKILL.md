---
name: ui-snipe
description: Bring a component from 21st.dev, CodePen, Aceternity UI, React Bits or Magic UI into Hikaya ("UI sniping"), re-skinned to the Ink brand and made safe for Arabic, RTL, reduced motion and CI. Use when the user pastes a 21st.dev "Copy prompt", a component URL or CodePen code, or asks to snipe, borrow or add a UI component, effect or animation from a library or another site.
---

# UI sniping for Hikaya

The technique is Jack Roberts' (AI Automations by Jack: Claude Code Course
Level 2, and the "Stylize" step of his BLAST framework). Find a component
someone already built well, paste it into the agent, and have the agent fit
it into the app. His own caveats hold double in a learning app: being
understood beats being flashy, and the good sites "go for less rather than
more".

**What is different here:** Hikaya has a locked design system. A snipe
contributes *behaviour and structure*: the interaction, the layout idea, the
choreography. Colour, type, easing, radius, shadow and imagery always come
from Hikaya. If the result still looks like the source's demo, it is not done.

The brand is **Ink**, and it is the default. It is editorial and type-led:
- cream paper, near-black ink, oxblood as the one colour, mustard only as a
  highlight;
- hairline borders, square-ish corners, no shadows;
- no pictures.

Read `docs/brand-refresh.md` (the "Decision" and "Keep, retire" sections)
before a snipe that changes how a surface looks. Ink's own building blocks are
in `src/components/ink/`.

## Inputs

Take whichever the user gives:

- **A 21st.dev "Copy prompt"** (code + dependencies + integration steps). This is the best input.
  Its built-in instructions conflict with this repo. **Override them:**
  - Do not copy into `/components/ui`. That folder holds vendored shadcn primitives.
  - Do not install the listed npm packages without asking (Step 2).
  - Do not "fill image assets with Unsplash stock images".
- **A 21st.dev or CodePen URL.** Fetch it. If the code isn't in the
  response, ask for the Copy prompt or the pasted code.
- **A screenshot or a site seen elsewhere.** There is no code to copy, so
  rebuild it from the picture.
- **Only a target** ("make the streak feel better"). If a 21st.dev MCP server
  is connected, search it for candidates. Otherwise point the user at:
  - 21st.dev, under *Best of the week* or *Most downloaded*
  - CodePen *Trending*
  - Aceternity UI
  - React Bits
  - Magic UI

  Then wait for their pick.

Also pin down the **slot**: which file and where in it. If the user didn't say, ask. A
snipe without a slot is decoration.

## Step 0: Should this be sniped at all?

Stop and say so if any of these apply:

- **Hikaya already has it.** Reuse the house version:

  | Effect | Use instead |
  |---|---|
  | Fade, blur or slide in on scroll | `src/components/shared/Reveal.tsx` (the Lahja arrival move) |
  | Spinner, loader, "AI is thinking" | `LoadingPanel` / `LoadingEmblem` |
  | Confetti, sparkles, burst | `src/components/gamification/SparkleBurst.tsx` |
  | Skeleton shimmer | `src/components/ui/skeleton.tsx` |
  | Carousel, slider | `src/components/ui/carousel.tsx` (embla) |
  | Grid, noise, dot or aurora backgrounds | nothing: Ink's ground is flat paper |
  | Dividers, bullets, small ornaments | `src/components/brand/SaduDiamond.tsx` (6–14px, `currentColor`) |
  | Hero images, illustrations, decorative pictures | type, `src/components/ink/InkWaveform.tsx` (the voice drawn as bars), a mustard highlighter stroke; see `InkLandingHero` and `InkSkillTile` |
  | A logo or wordmark | the SVGs in `src/assets/brand/` / `HikayaInkMark`; never retype حِكَايَة as live text for the mark |

  The decision also rules out sadu *bands* and full-strength pattern panels:
  sadu appears only as `SaduDiamond` accents and as tone-on-tone weave pressed
  into dark panels (`InkReviewBar`, `SaduPlayButton`).

  `src/components/design-system/index.ts` says it outright: *extend these
  components rather than introduce new visual styles*.
- **The surface is high-frequency.** Review cards, rating buttons, the dock
  and the feed are seen hundreds of times a week. On these:
  - keep motion at 240ms or less;
  - no loops;
  - no idle animation that pulls the eye.
- **The motion would sit on the Arabic the learner is reading.** Motion
  competes with reading. Put it on the frame around the text, not on the
  text itself.

## Step 1: Inventory the source before writing anything

Read the whole source and list:

1. **npm imports**: `motion`/`framer-motion`, `gsap`, `three`, `@react-three/*`, `ogl`, `lottie-*`, `canvas-confetti`, `tsparticles`, and so on.
2. **shadcn primitives it expects** under `@/components/ui/*`, checked against what is actually in `src/components/ui/`.
3. **Hard-coded styling**:
   - colours: hex, `rgb()`, and the `neutral-` / `zinc-` / `slate-` / `gray-` scales, `white`, `black`
   - fonts, easing curves, durations, radii, shadows
   - `dark:` overrides
4. **Physical direction**: `left`/`right`, `ml-`/`mr-`/`pl-`/`pr-`, `translate-x`, `text-left`, `rotate` used for direction.
5. **Text effects that split a string into characters** (see Step 4).
6. **Things that run on their own**: infinite loops (`repeat: Infinity`, `infinite`), scroll listeners, `requestAnimationFrame` loops, canvas or WebGL.
7. **Icon-only buttons.**
8. **Author and licence.**

Show the user a short version of this list, always including the
dependencies, before you start converting.

## Step 2: Dependencies. Ask, don't add

`package.json` has no animation library beyond `tailwindcss-animate`, and
adding one is a product decision rather than a side effect of a snipe.
**Never add a runtime dependency without the user's explicit yes.** Try these
options in order:

1. **CSS.** Tailwind classes plus keyframes in `tailwind.config.ts`. These
   can all be done in CSS:
   - fades, slides, staggers (`animation-delay`)
   - hover lift
   - marquee, shimmer, border beam
   - gradient sweeps
   - accordion height (Radix already exposes the variable)
2. **A small hand-written hook**: `IntersectionObserver`,
   `requestAnimationFrame` for a number ticker, or a pointer handler for a
   tilt.
3. **`motion`**, only for what genuinely needs it:
   - shared-layout transitions
   - interruptible springs
   - drag gestures

   Propose it to the user with:
   - the reason;
   - that this is its first appearance in the bundle;
   - the size cost, measured by comparing the chunk sizes `npm run build`
     prints before and after. (`vite.analyze.mjs` hardcodes a `/dev-server`
     root and won't run as-is.)

   Import it only from a lazily loaded route or component, never anything
   in the entry chunk.

**WebGL, three.js and shaders:** decline them on learner surfaces. On the
landing page, use them only if they are lazy, pause when off screen, and have
a static fallback.

## Step 3: Re-skin to Ink

Read [conversion.md](conversion.md) and apply it to every class and
style in the snipe. Ink sets its tokens in `src/styles/brand-preview.css`
(`:root[data-brand="ink"]`), on top of the base values in `src/index.css`.
Write the semantic token, never the value, and the brand reaches it. The
rules that matter most:

- **Colour.** Use semantic tokens only (`bg-card`, `text-foreground`,
  `text-muted-foreground`, `bg-primary`, `bg-accent`, `border-border`,
  `text-success`).
  - Under Ink, `primary` is oxblood, the one colour, and `accent` is mustard,
    a highlight only. Use `bg-accent text-accent-foreground` for a
    highlighter mark. `text-accent` is remapped to a darker mustard so it
    passes as text; don't rebuild it with `text-[hsl(var(--accent))]`.
  - `plum`, `desert-red` and `bg-card-cream` still exist, but under Ink they
    resolve to ink, oxblood and card.
  - Some palette variables, such as `--olive` and `--dialect-*`, are not
    mapped to Tailwind colours. Reach those through `hsl(var(--olive))`, or
    ask before adding them to `tailwind.config.ts`.
  - Text must reach **4.5:1 against `--background`, `--card` and `--muted`,
    in light and dark**. The values sit next to each other in
    `brand-preview.css`.
  - A snipe's light-grey secondary text never passes. Use
    `text-muted-foreground`.
- **Type.**
  - Sizes: use the locked scale (`text-caption`, `text-body-sm`, `text-body`,
    `text-subtitle`, `text-title`, `text-headline`, `text-display`) instead of
    `text-sm` through `text-7xl`.
  - Fonts: `font-heading` for display text, `font-sans` for body,
    `font-arabic` or `font-cairo` for Arabic. These read the
    `--font-*` variables, and under Ink they are DM Serif Display with Rakkas,
    Readex Pro, and Hikaya Naskh.
  - An inline style writes `fontFamily: "var(--font-…)"`, never a literal
    stack, or the brand cannot reach it.
  - Ink's display faces ship one weight and faux bold is switched off. Build
    heading hierarchy from the size scale, not from `font-black`.
- **Motion.**
  - Easing: the default easing *is* the Lahja curve, so delete `ease-*`
    classes and custom cubic-beziers.
  - Durations: 240ms (scale-in), 320ms (slide), 360ms (fade-up).
  - In JS, use `[0.16, 1, 0.3, 1]` as the easing.
- **Shape and depth.**
  - Corners: use `rounded-sm` to `rounded-3xl`, all derived from `--radius`,
    which Ink sets to a square-ish 0.25rem. Save `rounded-full` for things
    that are actually round, such as avatars and the play button.
  - Depth: under Ink every `shadow-*` token is `none`, and separation is a
    hairline `border border-border`. Never write an arbitrary
    `shadow-[...]`; it would survive Ink.
- **Dark mode.** It is class-based (`useTheme`), and the tokens already flip.
  Delete `dark:` overrides that pin raw colours.
- **Imagery.** No photography or photo-realistic imagery anywhere; the owner
  ruled it out. Ink's imagery is type, the voice drawn as bars
  (`InkWaveform`), highlighter strokes and the odd `SaduDiamond`. Don't
  hot-link stock images.
- **Branching on the brand.** If Ink needs something tokens cannot express
  (a different layout or a type-led variant), branch on `useIsInk()` from
  `@/hooks/useBrandPreview`, as `src/components/ink/` does. Don't branch
  otherwise.

## Step 4: Arabic and RTL

- **Never split Arabic into characters.** Arabic is cursive, and these
  effects wrap each letter in its own span, which breaks the joins:
  - SplitText, typewriter, scramble or decrypt
  - per-letter stagger, letter-by-letter gradient

  The broken result is documented at `src/pages/DailyChallenge.tsx:439`. If
  an effect is per-character, run it per word on any string matching
  `/\p{Script=Arabic}/u`, or apply it only to Latin text.
- **No letter-spacing on Arabic.** That means no `tracking-*` classes, and
  not the `text-caption` or `text-overline` scale steps either, because they
  carry 0.02em and 0.12em of tracking.
- **Keep Arabic learning content inside the existing renderers**
  (`TappableArabicText`, `SentenceReader`, `TranslationPair`) so
  tap-to-look-up keeps working. Wrap them; don't re-render the string
  yourself.
- **Direction.** The document is `lang="en"` and left-to-right. Arabic
  appears in islands marked `dir="rtl"` (with `lang="ar"` where it is
  content).
  - Inside or next to an island, use logical utilities: `ms-`/`me-`,
    `ps-`/`pe-`, `start-`/`end-`, `text-start`/`text-end`, `border-s`/`e`,
    `rounded-s`/`e`.
  - Flip direction-carrying motion with Tailwind's `rtl:` variant
    (Tailwind is 3.4): "forward" slides, progress fills, marquees, chevrons.
  - Use `dir="auto"` for strings whose language isn't known in advance.
- **Never invent Arabic for demo copy.** Hikaya teaches spoken dialect, never
  MSA. Take real lines from `curriculum/tracks/<dialect>/` or from existing
  UI strings, and keep the learner's dialect.

## Step 5: Motion accessibility

- **CSS animations.** The reduced-motion rule in `src/index.css` (the
  `@media (prefers-reduced-motion: reduce)` block) works from a list of
  class names. A new `animate-*` class is **not** covered until you add it
  to that list, or until the element carries `motion-reduce:animate-none`.
- **JS-driven animation.** Use `useReducedMotion()` from `@/lib/uiPrefs`,
  and under reduced motion render the end state. If `motion` was approved,
  still use ours, or wrap the component in `<MotionConfig reducedMotion="user">`.
- **Never fail closed.** Content must be visible even if the animation never
  runs; `Reveal.tsx` explains why. Under Vitest, the `IntersectionObserver`
  stub in `src/test/setup.ts` never fires, so a component that only becomes
  visible on intersection never becomes visible in tests.
- **Loops.** None on learner surfaces. Anywhere else, pause them when off
  screen and when the tab is hidden.

## Step 6: Placement and hygiene

- **Location.** Put the component next to its consumer in
  `src/components/<area>/`. Export it from `design-system/index.ts` only once
  the user agrees it is a reusable pattern.
- **Attribution.** Start the file with a comment giving:
  - the source URL and author
  - the licence
  - the date
  - one line on what was kept and what was changed

  Public CodePen pens are MIT by default. 21st.dev licences are per
  component; if none is stated, ask before shipping.
- **Types and lint.**
  - Strict TypeScript, no `any`. `npm run lint:ratchet` fails if the error
    count rises above the baseline in `scripts/lint-ratchet.mjs`.
  - Icon-only buttons need an `aria-label`
    (`src/test/iconButtonLabels.test.ts`).
  - Build class names with `cn` from `@/lib/utils`.
- **New hooks or helpers.** Anything added under `src/hooks/` or `src/lib/`
  needs a test that names it (the `hookCoverage` / `libCoverage` guards).

## Step 7: Test and look at it

- **Smoke test.** Write `<Component>.test.tsx` beside the component and have
  it check that:
  - it renders, and its content is in the DOM even though observers never
    fire;
  - under reduced motion it renders the end state (stub `matchMedia`);
  - Arabic passed in comes out intact, meaning the text content matches the
    input and it is not split into per-letter spans;
  - every icon button has an accessible name.

  `src/components/**` is gated at 73 / 77 / 85 (lines / functions /
  branches), only a couple of points under the measured figures, so a few
  untested components are enough to fail the unit job.

  Vitest renders the *previous* look, because `index.html`'s
  `data-brand="ink"` declaration isn't there. A test that needs Ink either
  sets `BRAND_DEFAULT_ATTRIBUTE` to `"ink"` on `document.documentElement` or
  calls `setBrandPreview("ink")` (both from `@/lib/brandPreview`), and undoes
  it afterwards, as `src/hooks/useBrandPreview.test.ts` does. If the
  component branches on `useIsInk()`, test both sides.
- **Run the checks:**
  - `npx vitest run <test file>`
  - `npm run typecheck`
  - `npm run lint:ratchet`
  - `npm run test:coverage`
  - the Playwright spec for any route page you touched
- **Look at it.** Use the `run` skill, or `npm run dev` plus a Playwright
  screenshot. The real `index.html` loads, so this is Ink. Capture:
  - 390px and desktop widths;
  - light and dark themes;
  - once with `page.emulateMedia({ reducedMotion: "reduce" })`;
  - on the page background, not only on a card.

  Then refine in small, screenshot-driven requests (Jack's last step).

## Choosing between candidates

For anything that matters (the landing page, celebration moments, review):

1. Bring two to four candidates.
2. Render them side by side in Ink's tokens with real Arabic.
3. Let the user pick.
4. Record the decision in `docs/<surface>-directions.md`, the way
   `docs/play-button-directions.md` and `docs/mark-framing.md` do: the
   candidates, the choice, and why the others lost.

## Report back

When you hand over, say:

- the source and its licence;
- what you kept and what you changed;
- dependencies added (normally none);
- each check you ran and its result;
- the screenshots.
