import { useMemo } from "react";
import { useTodayQueue } from "@/hooks/useTodayQueue";

/**
 * C — Progress horizon.
 * A thin "day arc" with a sun moving across a horizon line as the user
 * completes today's tasks. Ambient, no numbers.
 */
export const DayArc = () => {
  const tasks = useTodayQueue();

  const { progress, isDawn, isDusk } = useMemo(() => {
    const visible = tasks.filter((t) => !t.hidden);
    const total = visible.length || 1;
    const done = visible.filter((t) => t.done).length;
    const p = Math.min(1, Math.max(0, done / total));
    return { progress: p, isDawn: p < 0.15, isDusk: p > 0.85 };
  }, [tasks]);

  // Arc geometry: semicircle from (8, 36) to (292, 36), peak at (150, 6)
  const W = 300;
  const H = 40;
  const startX = 8;
  const endX = W - 8;
  const baseY = 36;
  const peakY = 6;

  // Quadratic Bezier point at t
  const t = progress;
  const oneMinusT = 1 - t;
  const cpX = (startX + endX) / 2;
  const cpY = peakY - (baseY - peakY); // control point for proper arc peak
  const sunX =
    oneMinusT * oneMinusT * startX + 2 * oneMinusT * t * cpX + t * t * endX;
  const sunY =
    oneMinusT * oneMinusT * baseY + 2 * oneMinusT * t * cpY + t * t * baseY;

  const sunColor = isDawn
    ? "hsl(28, 80%, 65%)"
    : isDusk
    ? "hsl(8, 70%, 58%)"
    : "hsl(42, 90%, 62%)";

  return (
    <div
      className="w-full mb-3 select-none pointer-events-none animate-fade-up"
      aria-hidden="true"
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        className="block"
      >
        <defs>
          <linearGradient id="dayarc-horizon" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="hsl(36, 30%, 75%)" stopOpacity="0.25" />
            <stop offset="50%" stopColor="hsl(20, 40%, 55%)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="hsl(36, 30%, 75%)" stopOpacity="0.25" />
          </linearGradient>
          <radialGradient id="dayarc-sun-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor={sunColor} stopOpacity="0.55" />
            <stop offset="100%" stopColor={sunColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Arc trail (subtle) */}
        <path
          d={`M ${startX} ${baseY} Q ${cpX} ${cpY} ${endX} ${baseY}`}
          fill="none"
          stroke="hsl(20, 25%, 50%)"
          strokeOpacity="0.18"
          strokeWidth="1"
          strokeDasharray="2 3"
        />

        {/* Horizon line */}
        <line
          x1={startX}
          x2={endX}
          y1={baseY}
          y2={baseY}
          stroke="url(#dayarc-horizon)"
          strokeWidth="1.25"
          strokeLinecap="round"
        />

        {/* Sun glow */}
        <circle
          cx={sunX}
          cy={sunY}
          r="9"
          fill="url(#dayarc-sun-glow)"
          style={{ transition: "cx 700ms ease-out, cy 700ms ease-out" }}
        />
        {/* Sun core */}
        <circle
          cx={sunX}
          cy={sunY}
          r="3.25"
          fill={sunColor}
          style={{ transition: "cx 700ms ease-out, cy 700ms ease-out, fill 500ms ease-out" }}
        />
      </svg>
    </div>
  );
};

export default DayArc;
