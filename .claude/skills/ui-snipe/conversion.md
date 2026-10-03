# Snipe → Hikaya conversion table

Apply this to every class and inline style in the sniped code. The left
column lists what 21st.dev, Aceternity, Magic UI and CodePen code typically
contains. Tokens are defined in `tailwind.config.ts` and `src/index.css`.

## Framework leftovers (most 21st.dev code is written for Next.js)

| Snipe | Hikaya |
|---|---|
| `"use client"` | delete it (Vite SPA) |
| `next/link` | `Link` / `NavLink` from `react-router-dom` |
| `next/image` | a plain `<img>` with `loading="lazy"`, explicit `width`/`height`, and real `alt` text (or `alt=""` with `aria-hidden` for ornament) |
| `next/font`, `font-[Inter]`, Geist | `font-heading` / `font-sans` / `font-arabic` |
| `clsx(...)`, `twMerge(clsx(...))` | `cn(...)` from `@/lib/utils` |
| `@tabler/icons-react`, `react-icons`, `@radix-ui/react-icons`, emoji used as icons | the matching `lucide-react` icon (already a dependency) |
| Unsplash or other hot-linked images | an asset from `src/assets/` or `public/assets/`; ask if nothing fits |

## Colour

| Snipe | Hikaya |
|---|---|
| `bg-white`, `bg-neutral-50`, `bg-zinc-50` (raised surface) | `bg-card` (or `bg-card-cream`) |
| `bg-neutral-100`, `bg-gray-100` (recessed surface) | `bg-muted` |
| `bg-black`, `bg-zinc-900`, `bg-neutral-950` (dark panel in light mode) | `bg-secondary text-secondary-foreground` |
| `text-black`, `text-neutral-900`, `text-zinc-800` | `text-foreground` |
| `text-neutral-400/500/600`, `text-gray-*`, `text-white/60` | `text-muted-foreground` (the only grey that passes 4.5:1 on tinted sand) |
| `bg-blue-*`, `bg-indigo-*`, `bg-violet-*` (the brand/CTA colour) | `bg-primary text-primary-foreground` |
| `from-purple-500 to-pink-500` and other rainbow gradients | token gradients only, e.g. `from-primary/15 to-transparent`; a gradient is rarely needed |
| `text-green-*`, `bg-emerald-*` | `text-success`, `bg-success text-success-foreground` |
| `text-red-*`, `bg-red-*` | `text-destructive`, `bg-destructive text-destructive-foreground` |
| `border-neutral-200`, `border-white/10`, `border-zinc-800` | `border-border` |
| `ring-blue-500`, custom focus outlines | `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background` |
| `dark:bg-*`, `dark:text-*` pinned to raw colours | delete them; the tokens flip under `.dark` |
| `bg-white/10 backdrop-blur` (glass) | `bg-card/80 backdrop-blur-sm`, used sparingly, with contrast re-checked over the sadu art |

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
| `rounded-[14px]` or other arbitrary radii | the nearest of `rounded-sm` … `rounded-3xl` (all derived from `--radius`) |
| `shadow-sm` | `shadow-soft` |
| `shadow-md`, `shadow-lg` | `shadow-card` |
| `shadow-xl`, `shadow-2xl` | `shadow-elegant` |
| button shadows | `shadow-button` |
| `shadow-[0_0_40px_rgba(...)]` glow | delete it, or rebuild it from a token colour at low alpha |
| grid, dot, noise, aurora or beam backgrounds | `SaduBanner`, `public/assets/sadu-tile.svg` / `sadu-watermark.svg`, or nothing |

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
