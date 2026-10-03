import { cn } from "@/lib/utils";

/**
 * The Ink direction's waveform-bar motif: a row of thin vertical bars.
 *
 * Ink's imagery is type, a voice drawn as bars, highlighter strokes and the
 * odd sadu diamond — no pictures. This is the voice. Heights are fixed
 * sequences rather than random so a tile looks the same on every render and
 * in every screenshot.
 *
 * Purely decorative: hidden from assistive tech, and coloured by
 * currentColor so the caller sets it with an ordinary text colour.
 */

/** A spoken phrase: a rise, a stressed peak, a tail. Heights in % of the box. */
const SPOKEN_PHRASE = [
  17, 28, 44, 25, 61, 83, 50, 33, 67, 100, 72, 44, 28, 56, 89, 100, 61, 39, 22, 44, 72, 94, 56, 33,
  19, 39, 61, 89, 78, 50, 28, 44, 67, 56, 33, 19,
];

export interface InkWaveformProps {
  /** Bar heights as percentages of the box height. */
  bars?: readonly number[];
  /** Bar width and gap in px. */
  barWidth?: number;
  gap?: number;
  /** Bars grow from the bottom instead of the centre line. */
  baseline?: boolean;
  className?: string;
}

export function InkWaveform({
  bars = SPOKEN_PHRASE,
  barWidth = 3,
  gap = 2,
  baseline = false,
  className,
}: InkWaveformProps) {
  return (
    <span
      aria-hidden="true"
      data-ink-waveform=""
      className={cn("pointer-events-none flex overflow-hidden", baseline ? "items-end" : "items-center", className)}
      style={{ gap }}
    >
      {bars.map((h, i) => (
        <i
          key={i}
          className="block shrink-0 rounded-[1px] bg-current"
          style={{ width: barWidth, height: `${Math.max(4, Math.min(100, h))}%` }}
        />
      ))}
    </span>
  );
}
