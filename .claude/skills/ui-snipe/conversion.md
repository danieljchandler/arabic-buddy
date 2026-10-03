# Snipe → Hikaya conversion table

Apply this to every class and inline style in the sniped code. The left
column lists what 21st.dev, Aceternity, Magic UI and CodePen code typically
contains. Tokens are defined in `tailwind.config.ts` and `src/index.css`.
Ink, the default brand, overrides their values in `src/styles/brand-preview.css`.
Write the token, and both resolve correctly.

## Framework leftovers (most 21st.dev code is written for Next.js)

| Snipe | Hikaya |
|---|---|
| `"use client"` | delete it (Vite SPA) |
| `next/link` | `Link` / `NavLink` from `react-router-dom` |
| `next/image` | a plain `<img>` with `loading="lazy"`, explicit `width`/`height`, and real `alt` text (or `alt=""` with `aria-hidden` for ornament) |
| `next/font`, `font-[Inter]`, Geist | `font-heading` / `font-sans` / `font-arabic` |
| inline `fontFamily: "Inter, sans-serif"` | `fontFamily: "var(--font-sans)"` (or `--font-heading`, `--font-arabic`); never a literal stack |
| `clsx(...)`, `twMerge(clsx(...))` | `cn(...)` from `@/lib/utils` |
| `@tabler/icons-react`, `react-icons`, `@radix-ui/react-icons`, emoji used as icons | the matching `lucide-react` icon (already a dependency) |
| Unsplash, stock photos, any photo-realistic image | none: photography is ruled out. Use type, `InkWaveform`, a highlighter stroke or `SaduDiamond`; ask if nothing fits |

## Colour

| Snipe | Hikaya |
|---|---|
| `bg-white`, `bg-neutral-50`, `bg-zinc-50` (raised surface) | `bg-card` plus a hairline `border border-border` |
| `bg-neutral-100`, `bg-gray-100` (recessed surface) | `bg-muted` |
| `bg-black`, `bg-zinc-900`, `bg-neutral-950` (dark panel in light mode) | `bg-secondary text-secondary-foreground` (an ink panel under Ink), or `bg-primary text-primary-foreground` for an oxblood one |
| `text-black`, `text-neutral-900`, `text-zinc-800` | `text-foreground` |
| `text-neutral-400/500/600`, `text-gray-*`, `text-white/60` | `text-muted-foreground` (the only grey that passes 4.5:1 on background, card and muted in both themes) |
| `bg-blue-*`, `bg-indigo-*`, `bg-violet-*` (the brand/CTA colour) | `bg-primary text-primary-foreground` (oxblood under Ink) |
| `bg-yellow-*`, `bg-amber-*`, marker or highlight effects | `bg-accent text-accent-foreground` (mustard), as a highlighter only, never a second brand colour |
| `from-purple-500 to-pink-500` and other rainbow gradients | a flat token fill; Ink is flat colour on paper, so drop the gradient |
| `text-green-*`, `bg-emerald-*` | `text-success`, `bg-success text-success-foreground` |
| `text-red-*`, `bg-red-*` | `text-destructive`, `bg-destructive text-destructive-foreground` |
| `border-neutral-200`, `border-white/10`, `border-zinc-800` | `border-border` |
| `ring-blue-500`, custom focus outlines | `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background` |
| `dark:bg-*`, `dark:text-*` pinned to raw colours | delete them; the tokens flip under `.dark` |
| `bg-white/10 backdrop-blur` (glass) | `bg-card border border-border`; Ink has no glass |

## Type

| Snipe | Hikaya |
|---|---|
| `text-xs` | `text-caption` (Latin only: it carries 0.02em tracking) |
| `text-sm` | `text-body-sm` |
| `text-base` | `text-body` |
| `text-lg` | `text-subtitle` |
| `text-xl`, `text-2xl` | `text-title` |
| `text-3xl`, `text-4xl` | `text-headline` |
| `text-5xl` and up | `text-display` |
| `uppercase tracking-widest text-xs` (eyebrow label) | `text-overline uppercase` (Latin only) |
| any `tracking-*`, `text-caption` or `text-overline` on Arabic | remove the tracking, or add `tracking-normal`; set Arabic at `text-body-sm` or larger |
| `font-black` / `font-extrabold` carrying heading hierarchy | a step up the size scale; Ink's display faces have one weight and faux bold is off |

## Motion

| Snipe | Hikaya |
|---|---|
| `transition-all duration-300 ease-in-out` | `transition-[transform,opacity] duration-300` (the default easing *is* the Lahja curve) |
| `ease-[cubic-bezier(...)]`, `ease-out`, `ease-in-out` | delete it |
| `animate-in fade-in slide-in-from-bottom-4` | `animate-fade-up` |
| zoom or scale entrance | `animate-scale-in` |
| sheet or drawer entrance | `animate-slide-in` / `animate-slide-in-bottom` |
| fade or slide on scroll (`whileInView`, AOS, custom observer) | wrap in `Reveal` |
| `animate-pulse` placeholder | the `ui/skeleton` shimmer |
| `animate-spin` loader | `LoadingEmblem` / `LoadingPanel` |
| `animate-bounce` | `animate-bounce-gentle`, and only as a tap hint |
| `whileHover={{ scale: 1.05 }}` | `transition-transform hover:scale-[1.02] motion-reduce:hover:scale-100` |
| motion `{ duration: 0.5, ease: "easeOut" }` | `{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }` |
| stagger 0.1–0.3s between children | at most 150ms (`Reveal` explains why) |
| `repeat: Infinity`, `infinite` | delete it on learner surfaces; elsewhere, pause when off screen |

## Shape and depth

| Snipe | Hikaya |
|---|---|
| `rounded-[14px]` or other arbitrary radii | the nearest of `rounded-sm` … `rounded-3xl` (all derived from `--radius`, a square-ish 0.25rem under Ink) |
| `rounded-full` pills and chips | `rounded-md`; keep `rounded-full` for things that are round (avatars, the play button) |
| `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl` | a hairline `border border-border`. If the previous look needs depth too, the token classes (`shadow-soft`, `shadow-card`, `shadow-elegant`, `shadow-button`) are safe, because they are `none` under Ink |
| `shadow-[0_0_40px_rgba(...)]` glow, or any arbitrary shadow | delete it; an arbitrary shadow survives Ink's no-shadow rule |
| grid, dot, noise, aurora or beam backgrounds | nothing; Ink's ground is flat paper |
| sadu bands, pattern strips, `SaduBanner` | not under Ink. Use `SaduDiamond` (6–14px) for a divider or bullet; pressed tone-on-tone weave belongs only on dark panels (`InkReviewBar`) |

## Direction (RTL)

| Snipe | Hikaya |
|---|---|
| `ml-*` / `mr-*` | `ms-*` / `me-*` |
| `pl-*` / `pr-*` | `ps-*` / `pe-*` |
| `left-*` / `right-*` | `start-*` / `end-*` |
| `text-left` / `text-right` | `text-start` / `text-end` |
| `border-l` / `border-r` | `border-s` / `border-e` |
| `rounded-l-*` / `rounded-r-*` | `rounded-s-*` / `rounded-e-*` |
| `space-x-*` | `gap-*` on a flex or grid parent |
| `translate-x-full` (enter from the side) | add `rtl:-translate-x-full` |
| `ChevronRight` / `ArrowRight` meaning "next" | add `rtl:rotate-180` |
| progress or marquee moving left to right | flip the direction with the `rtl:` variant |
