import type { CSSProperties } from "react";
import { jitter, type SceneEffect } from "@/lib/dances";

/**
 * The effects a vignette asks for, drawn in code over its figure: flames and
 * embers, smoke, steam, sparkle, and an ink stroke. They are cut-paper shapes
 * in the stage's own colours, not photographs, so a fire can grow with a
 * streak without another still, and they follow the brand.
 *
 * Every position is `jitter` of the shape's index, so a given scene looks the
 * same each time it plays (and in a test). Under reduced motion the shapes sit
 * in place and nothing moves.
 */

interface StageEffectsProps {
  effects: readonly SceneEffect[];
  /** 1 (a few sparks) to 5 (a blaze). */
  heat: number;
  /** Where flames and smoke rise from, as a percentage of the box from its left and top. */
  anchor: { x: number; y: number };
  reduced?: boolean;
  /** The figure's box (its position variables), so the effects sit where the figure does. */
  style?: CSSProperties;
}

const r = jitter;
const pct = (n: number) => `${n.toFixed(2)}%`;

export function StageEffects({ effects, heat, anchor, reduced = false, style }: StageEffectsProps) {
  const h = Math.min(5, Math.max(1, Math.round(heat)));
  const has = (e: SceneEffect) => effects.includes(e);
  const fire = has("fire");
  const spread = 10 + h * 4;

  const flames = fire ? 2 + h * 2 : 0;
  const embers = fire ? 3 + h * 3 : 0;
  // Smoke over a fire comes only once the fire has some body; on its own (the
  // incense) it is the whole effect.
  const smoke = has("smoke") ? (fire ? Math.max(0, h - 1) : h + 1) : 0;
  const steam = has("steam") ? 2 + h : 0;
  const sparkles = has("sparkle") ? 4 + h * 2 : 0;

  const layer = (name: "back" | "front") => `cel-fx cel-fx-${name} ${reduced ? "cel-fx-still" : ""}`;

  return (
    <>
      {/* Behind the figure: flames and smoke come up from behind the grill's rim and skewers. */}
      <div className={layer("back")} style={style} aria-hidden="true" data-testid="stage-effects">
      {Array.from({ length: smoke }, (_, i) => {
        const size = 9 + r(i, 11) * 6;
        return (
          <span
            key={`smoke-${i}`}
            className="cel-smoke"
            data-fx="smoke"
            style={
              {
                left: pct(anchor.x + (r(i, 12) - 0.5) * spread * 0.9 - size / 2),
                top: pct(anchor.y - 8),
                width: pct(size),
                "--cel-rise": `${(-18 - r(i, 13) * 14 - h * 3).toFixed(1)}cqw`,
                "--cel-drift": `${((r(i, 14) - 0.5) * 12).toFixed(1)}cqw`,
                "--cel-delay": `${Math.round(r(i, 15) * 2400)}ms`,
              } as CSSProperties
            }
          />
        );
      })}

      {Array.from({ length: flames }, (_, i) => {
        const w = 4 + r(i, 1) * 2.6 + h * 0.6;
        const fh = 9 + r(i, 2) * 5 + h * 3;
        return (
          <span
            key={`flame-${i}`}
            className={`cel-flame ${i % 3 === 0 ? "cel-flame-hot" : ""}`}
            data-fx="flame"
            style={
              {
                left: pct(anchor.x + (r(i, 3) - 0.5) * spread - w / 2),
                top: pct(anchor.y - fh),
                width: pct(w),
                height: pct(fh),
                "--cel-delay": `${Math.round(r(i, 4) * 600)}ms`,
                "--cel-lean": `${((r(i, 5) - 0.5) * 8).toFixed(1)}deg`,
              } as CSSProperties
            }
          />
        );
      })}
      </div>

      {/* In front: what drifts, glints or is drawn over the figure. */}
      <div className={layer("front")} style={style} aria-hidden="true" data-testid="stage-effects-front">
      {Array.from({ length: steam }, (_, i) => {
        const size = 5 + r(i, 21) * 3;
        return (
          <span
            key={`steam-${i}`}
            className="cel-steam"
            data-fx="steam"
            style={
              {
                left: pct(anchor.x + (r(i, 22) - 0.5) * 26 - size / 2),
                top: pct(anchor.y - 10),
                width: pct(size),
                "--cel-rise": `${(-12 - r(i, 23) * 10).toFixed(1)}cqw`,
                "--cel-drift": `${((r(i, 24) - 0.5) * 8).toFixed(1)}cqw`,
                "--cel-delay": `${Math.round(r(i, 25) * 2200)}ms`,
              } as CSSProperties
            }
          />
        );
      })}

      {Array.from({ length: embers }, (_, i) => (
        <span
          key={`ember-${i}`}
          className="cel-ember"
          data-fx="ember"
          style={
            {
              left: pct(anchor.x + (r(i, 31) - 0.5) * spread * 1.3),
              top: pct(anchor.y - 4),
              width: `${(3 + r(i, 32) * 3).toFixed(1)}px`,
              "--cel-rise": `${(-12 - r(i, 33) * 16 - h * 2).toFixed(1)}cqw`,
              "--cel-drift": `${((r(i, 34) - 0.5) * 14).toFixed(1)}cqw`,
              "--cel-delay": `${Math.round(r(i, 35) * 2000)}ms`,
              "--cel-dur": `${Math.round(1300 + r(i, 36) * 1100)}ms`,
            } as CSSProperties
          }
        />
      ))}

      {Array.from({ length: sparkles }, (_, i) => (
        <span
          key={`sparkle-${i}`}
          className="cel-sparkle"
          data-fx="sparkle"
          style={
            {
              left: pct(4 + r(i, 41) * 88),
              top: pct(2 + r(i, 42) * 78),
              width: `${(3.2 + r(i, 43) * 4.2).toFixed(1)}cqw`,
              "--cel-delay": `${Math.round(r(i, 44) * 1500)}ms`,
              "--cel-dur": `${Math.round(900 + r(i, 45) * 700)}ms`,
            } as CSSProperties
          }
        />
      ))}

      {has("ink") && (
        <svg className="cel-ink" data-fx="ink" viewBox="0 0 100 50" preserveAspectRatio="xMidYMid meet">
          {/* A reed pen's stroke: thick on the downstroke, a long swash out of it. */}
          <path
            d="M10 34 C 18 6, 36 4, 42 26 C 46 40, 58 46, 66 24 C 72 8, 86 8, 92 20"
            pathLength={100}
          />
          <circle cx="92" cy="20" r="2.6" />
        </svg>
      )}
      </div>
    </>
  );
}
