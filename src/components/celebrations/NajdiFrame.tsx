import { useId } from "react";

/**
 * The framed title of the Ardah scene. Collage explainers put the title in an
 * ornate gilt frame; ours is drawn from Najdi mud-brick architecture instead —
 * the stepped parapet along a roofline, and the painted triangles of a Najdi
 * door in the band. Each dialect's dance gets its own frame (a mashrabiya for
 * Egyptian, a qamariya window for Yemeni) when its scene is made.
 */

const PARAPET = Array.from({ length: 13 }, (_, i) => {
  const x = 8 + i * 24;
  return `M${x} 24 L${x + 8} 12 L${x + 16} 24 Z`;
}).join(" ");

const BAND_TRIANGLES = [
  ...Array.from({ length: 20 }, (_, i) => {
    const x = 10 + i * 15;
    const fill = i % 2 ? "#6B1F1F" : "#F7F1E3";
    return [
      { d: `M${x} 37 L${x + 7} 26 L${x + 14} 37 Z`, fill },
      { d: `M${x} 119 L${x + 7} 130 L${x + 14} 119 Z`, fill },
    ];
  }).flat(),
  ...Array.from({ length: 5 }, (_, j) => {
    const y = 40 + j * 16;
    const fill = j % 2 ? "#F7F1E3" : "#6B1F1F";
    return [
      { d: `M9 ${y} L20 ${y + 7} L9 ${y + 14} Z`, fill },
      { d: `M311 ${y} L300 ${y + 7} L311 ${y + 14} Z`, fill },
    ];
  }).flat(),
];

export function NajdiFrame({ title, className }: { title: string; className?: string }) {
  const rough = `cel-rough-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 320 136" className={className} aria-hidden="true" focusable="false">
      <defs>
        {/* A slightly chewed edge on the title, like ink on rough paper. */}
        <filter id={rough} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <g fill="#1A1C17">
        <path d={PARAPET} />
        <path fillRule="evenodd" d="M8 24 H312 V132 H8 Z M22 38 H298 V118 H22 Z" />
      </g>
      {BAND_TRIANGLES.map((t) => (
        <path key={t.d} d={t.d} fill={t.fill} />
      ))}
      <rect x="22" y="38" width="276" height="80" fill="#F7F1E3" />
      <text
        x="160"
        y="98"
        textAnchor="middle"
        direction="rtl"
        fontSize="58"
        fill="#1A1C17"
        filter={`url(#${rough})`}
        style={{ fontFamily: "var(--font-ink-display, 'Rakkas'), 'Noto Naskh Arabic', serif" }}
      >
        {title}
      </text>
    </svg>
  );
}
