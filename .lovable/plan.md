## Goal
Reskin the Gulf dialect module: swap the wave emoji for a simple SVG illustration of the Arabian peninsula, and shift its color scheme from teal to a Sadu‑weaving palette (deep brick red with warm camel/black accents).

## Color direction (Sadu-inspired)
Sadu textiles are dominated by deep red, black, warm camel browns, and cream. The Gulf module currently uses teal `180 65% 32%`. I'll retune it to a Sadu brick red that stays clearly distinct from Yemeni's brighter red (`0 70% 42%`):

- Gulf primary: `12 68% 32%` (deep Sadu brick/madder red)
- Gulf glow:    `28 70% 48%` (camel/amber accent)
- Gulf ring:    `12 68% 32%`

These propagate to the dialect chip background tint, picker card border, Arabic title color, and any other place that reads from the Gulf token.

## Icon
Replace the 🌊 emoji on the Gulf card / chip with a small, flat SVG illustration of the Arabian peninsula (single filled silhouette with a subtle inner stroke — no labels, no borders of other countries). It will inherit `currentColor` so it tints with the active Sadu red.

New file: `src/components/icons/ArabianPeninsulaIcon.tsx` — a `<svg viewBox="0 0 24 24">` peninsula path, accepts `className`.

## Files to change

1. `src/components/icons/ArabianPeninsulaIcon.tsx` (new) — peninsula SVG.
2. `src/components/DialectRitualSwitcher.tsx`
   - Update Gulf entry: `hsl: "12 68% 32%"`.
   - For Gulf, render `<ArabianPeninsulaIcon />` in the picker card icon tile and in the active chip's icon tile instead of `{d.flag}` / `{current.flag}`. Egyptian and Yemeni keep their flag emojis.
3. `src/contexts/DialectContext.tsx`
   - Update Gulf token: `{ primary: '12 68% 32%', ring: '12 68% 32%', glow: '28 70% 48%' }`.
   - Update the "// Gulf — teal" comment to "// Gulf — Sadu red".
4. `src/pages/Profile.tsx` (line 27)
   - Update Gulf entry color to `12 68% 32%` and emoji → still shown as emoji elsewhere; if Profile renders the emoji, swap to the peninsula icon import there too. (I'll inspect Profile briefly before editing to confirm whether to replace the emoji here or leave it.)
5. `src/config.ts` and `src/pages/Index.tsx` line 73
   - `DIALECT_FLAGS.Gulf` / `DIALECT_MODULES` Gulf flag emoji: leave the data field as-is OR replace with a non-emoji marker. Since `DIALECT_MODULES` in Index isn't currently rendered and `config.ts` `DIALECT_FLAGS` is referenced in a few places, I'll grep its usages and either (a) keep 🌊 as a harmless fallback string, or (b) replace each render site with the peninsula icon. Default plan: keep the string in config but render the icon at the Gulf-specific UI surfaces (switcher + profile). No business-logic changes.

## Out of scope
No changes to lesson content, prompts, audio routing, or other dialects. Egyptian (amber) and Yemeni (red) palettes stay as-is.
