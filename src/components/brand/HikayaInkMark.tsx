import { cn } from "@/lib/utils";
import { useInkMarkVariant } from "@/hooks/useBrandPreview";
import type { InkMarkVariant } from "@/lib/brandPreview";
import { INK_MARK_ART, INK_MARK_ASPECT, type InkMarkKind } from "./inkMarkArt";

/**
 * The Hikaya mark in the Ink direction. Only rendered while the Ink preview
 * is on (`?brand=ink`).
 *
 * A solid ink speech bubble with its tail at the bottom left, a cream
 * waveform across it — a voice, which is what the app teaches — and the name
 * beside it in Rakkas, oxblood. Drawn from the production logo set in
 * src/assets/brand (outlined SVGs: the Arabic is shaped on the real Rakkas
 * and converted to paths, so nothing here depends on a web font loading).
 * The word is never retyped as live text.
 *
 * **The name carries a kasra.** حِكَايَة, ḥikāya. Today's raster vowels the ح
 * with a fatha, which reads ḥakāya — the old spelling. `harakat={false}`
 * gives the unvowelled حكاية, with the same kashida, for places that want it;
 * vowelled is the default.
 *
 * Two variants, by the owner's decision:
 * - `sadu` — the primary: a faint tone-on-tone sadu weave clipped inside the
 *   bubble, as today's mark carries a sadu fill. It reads as texture up close
 *   and disappears at small sizes; that is intended.
 * - `clean` — the secondary: the same bubble, flat.
 * Left unset, the variant follows `?mark=sadu|clean` (default sadu).
 *
 * **The same drawing at every size**, also by decision: no simplified
 * waveform, no dropped harakat for small uses. The logo set's stated minimum
 * is 160px wide for the mark; the page corner, at 48px tall, sits just under
 * it, as the owner accepted.
 *
 * `wordmark` swaps the mark for the lockup (the name over "Hikaya" in DM
 * Serif Display). Night mode swaps each for its `-reverse` file (cream
 * bubble, mustard name) through a pair of images toggled by the `.dark`
 * class, so the right one shows on first paint with no script.
 *
 * One accessible name, "Hikaya", on the wrapper; the images are decorative
 * inside it, so a screen reader hears the name once in either theme.
 */

export interface HikayaInkMarkProps {
  /** Defaults to the `?mark=` choice (sadu unless `?mark=clean`). */
  variant?: InkMarkVariant;
  /** The lockup — name over the "Hikaya" wordmark — instead of the mark. */
  wordmark?: boolean;
  /** Vowel the name (حِكَايَة). Default true; false gives حكاية. */
  harakat?: boolean;
  /** Rendered height in px; the width follows the artwork. */
  size?: number;
  className?: string;
}

export function HikayaInkMark({
  variant,
  wordmark = false,
  harakat = true,
  size = 48,
  className,
}: HikayaInkMarkProps) {
  const chosen = useInkMarkVariant();
  const mark = variant ?? chosen;
  const kind: InkMarkKind = wordmark ? "lockup" : "mark";
  const art = INK_MARK_ART[mark][harakat ? "harakat" : "plain"][kind];
  const width = Math.round(size * INK_MARK_ASPECT[kind]);

  return (
    <span
      role="img"
      aria-label="Hikaya"
      data-ink-mark={mark}
      data-ink-mark-kind={kind}
      className={cn("inline-flex shrink-0 select-none items-center", className)}
    >
      <img
        src={art.light}
        alt=""
        aria-hidden="true"
        width={width}
        height={size}
        draggable={false}
        className="block max-w-none dark:hidden"
      />
      <img
        src={art.reverse}
        alt=""
        aria-hidden="true"
        width={width}
        height={size}
        draggable={false}
        className="hidden max-w-none dark:block"
      />
    </span>
  );
}
