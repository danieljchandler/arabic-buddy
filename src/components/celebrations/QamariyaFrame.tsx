import { useId } from "react";
import { titleFontSize } from "./frameTitle";

/**
 * The framed title of a Yemeni dance: a qamariya, the half-moon window of
 * coloured glass set in white gypsum above the windows of Sana'a's tower
 * houses, crowning a band of the white zigzag gypsum friezes that run round
 * those houses. Same box and title area as the Najdi frame.
 */

const FAN = { cx: 160, cy: 26, r: 24 };
const GLASS = ["#6B1F1F", "#E2B65C", "#F7F1E3", "#E2B65C", "#6B1F1F", "#E2B65C"];

// The fan's coloured panes, as wedges of the half circle.
const PANES = GLASS.map((fill, i) => {
  const a0 = Math.PI * (1 + i / GLASS.length);
  const a1 = Math.PI * (1 + (i + 1) / GLASS.length);
  const r = FAN.r - 3;
  const p = (a: number) => `${(FAN.cx + r * Math.cos(a)).toFixed(2)} ${(FAN.cy + r * Math.sin(a)).toFixed(2)}`;
  return { d: `M${FAN.cx} ${FAN.cy} L${p(a0)} A${r} ${r} 0 0 1 ${p(a1)} Z`, fill };
});

// White gypsum zigzag along the top and bottom of the band.
const zigzag = (y: number, h: number) =>
  Array.from({ length: 30 }, (_, i) => `${14 + i * 10},${i % 2 ? y : y + h}`).join(" ");

export function QamariyaFrame({ title, className }: { title: string; className?: string }) {
  const rough = `cel-rough-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 320 136" className={className} aria-hidden="true" focusable="false">
      <defs>
        <filter id={rough} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <rect x="8" y="24" width="304" height="108" fill="#1A1C17" />
      {/* The gypsum band and its zigzags. */}
      <rect x="12" y="28" width="296" height="100" fill="#F7F1E3" />
      <polyline points={zigzag(29, 6)} fill="none" stroke="#1A1C17" strokeWidth="1.6" />
      <polyline points={zigzag(121, 6)} fill="none" stroke="#1A1C17" strokeWidth="1.6" />
      <rect x="20" y="37" width="280" height="83" fill="#1A1C17" />
      <rect x="22" y="39" width="276" height="79" fill="#F7F1E3" />
      {/* The qamariya: an ink half-moon, coloured panes, gypsum tracery. */}
      <path d={`M${FAN.cx - FAN.r} ${FAN.cy} A${FAN.r} ${FAN.r} 0 0 1 ${FAN.cx + FAN.r} ${FAN.cy} Z`} fill="#1A1C17" />
      {PANES.map((pane) => (
        <path key={pane.d} d={pane.d} fill={pane.fill} stroke="#F7F1E3" strokeWidth="1.4" />
      ))}
      <circle cx={FAN.cx} cy={FAN.cy} r="5" fill="#F7F1E3" stroke="#1A1C17" strokeWidth="1" />
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
