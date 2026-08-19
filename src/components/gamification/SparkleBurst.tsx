import { useReducedMotion } from "@/lib/uiPrefs";

/**
 * A one-shot scatter of gold sparkles for reward moments — daily goal
 * complete, deck cleared. Rides the existing `animate-sparkle` keyframes
 * (700ms, fades out, `forwards`), staggered so the burst reads as a moment
 * rather than a blink. Purely decorative: hidden from the accessibility tree
 * and absent entirely under reduced motion, where a static card already says
 * everything this does.
 *
 * Position: absolutely fills its nearest positioned ancestor — the host card
 * adds `relative` and drops this in.
 */
const SPARKS: Array<{ top: string; left: string; delay: number; size: number }> = [
  { top: "12%", left: "12%", delay: 0, size: 8 },
  { top: "22%", left: "82%", delay: 120, size: 6 },
  { top: "64%", left: "8%", delay: 240, size: 5 },
  { top: "10%", left: "48%", delay: 320, size: 7 },
  { top: "70%", left: "88%", delay: 420, size: 8 },
  { top: "42%", left: "94%", delay: 560, size: 5 },
];

export function SparkleBurst() {
  const reduced = useReducedMotion();
  if (reduced) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {SPARKS.map((s, i) => (
        <span
          key={i}
          className="animate-sparkle absolute rounded-full bg-amber-400 opacity-0"
          style={{
            top: s.top,
            left: s.left,
            width: s.size,
            height: s.size,
            animationDelay: `${s.delay}ms`,
            boxShadow: "0 0 6px 1px hsl(43 90% 60% / 0.6)",
          }}
        />
      ))}
    </div>
  );
}
