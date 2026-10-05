import { useId } from "react";
import { titleFontSize } from "./frameTitle";

/**
 * The framed title of an Egyptian dance: a Cairo mashrabiya, the turned-wood
 * lattice of old Cairene windows, as the band around the title, under a row of
 * the stepped crenellations that crown Mamluk walls. Same box and title area
 * as the Najdi frame, so the stage lays them out the same way.
 */

// Stepped merlons along the top edge.
const CRENELLATIONS = Array.from({ length: 12 }, (_, i) => {
  const x = 10 + i * 25;
  return `M${x} 22 V17 H${x + 3} V12 H${x + 6} V7 H${x + 13} V12 H${x + 16} V17 H${x + 19} V22 Z`;
}).join(" ");

export function MashrabiyaFrame({ title, className }: { title: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  const rough = `cel-rough-${id}`;
  const lattice = `cel-lattice-${id}`;
  return (
    <svg viewBox="0 0 320 136" className={className} aria-hidden="true" focusable="false">
      <defs>
        <filter id={rough} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        {/* One cell of turned-wood lattice: a bead at each crossing, open
            squares between, the way the spindles of a mashrabiya leave holes. */}
        <pattern id={lattice} width="9" height="9" patternUnits="userSpaceOnUse">
          <rect width="9" height="9" fill="#1A1C17" />
          <rect x="2" y="2" width="5" height="5" fill="#E2B65C" />
          <circle cx="0" cy="0" r="1.6" fill="#6B1F1F" />
          <circle cx="9" cy="0" r="1.6" fill="#6B1F1F" />
          <circle cx="0" cy="9" r="1.6" fill="#6B1F1F" />
          <circle cx="9" cy="9" r="1.6" fill="#6B1F1F" />
        </pattern>
      </defs>
      <path d={CRENELLATIONS} fill="#1A1C17" />
      <rect x="8" y="22" width="304" height="110" fill="#1A1C17" />
      <rect x="12" y="26" width="296" height="102" fill={`url(#${lattice})`} />
      <rect x="20" y="34" width="280" height="86" fill="#1A1C17" />
      <rect x="22" y="38" width="276" height="80" fill="#F7F1E3" />
      <text
        x="160"
        y="98"
        textAnchor="middle"
        direction="rtl"
        fontSize={titleFontSize(title)}
        fill="#1A1C17"
        filter={`url(#${rough})`}
        style={{ fontFamily: "var(--font-ink-display, 'Rakkas'), 'Noto Naskh Arabic', serif" }}
      >
        {title}
      </text>
    </svg>
  );
}
