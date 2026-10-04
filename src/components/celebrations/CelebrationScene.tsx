import { useEffect, useState, type CSSProperties } from "react";
import { useReducedMotion } from "@/lib/uiPrefs";
import { poseAt, type CelebrationTier, type DanceDefinition } from "@/lib/celebrations";
import { DANCE_ART } from "./danceArt";
import { NajdiFrame } from "./NajdiFrame";
import "./celebration.css";

/**
 * The collage stage: a grayscale cutout row of dancers snapping from pose to
 * pose and swaying together, a drummer in the open space the row faces, over
 * mustard paper with faint print, an oxblood circle, a scrap of grid paper,
 * tape, and the dance's name in a Najdi frame. Only the dancers are pictures;
 * everything else is drawn here so it stays on-brand.
 *
 * Under reduced motion it holds the first pose, which `poseAt` keeps untilted,
 * and the row doesn't sway.
 */

// Faint print for the paper: dance and place names only, so there is no
// sentence in it to get wrong.
const PRINT_WORDS = [
  "العرضة", "نجد", "الرياض", "الطبل", "السيف", "القصيد", "الصف", "الراية",
  "العيالة", "الرزحة", "المزمار", "الحجاز", "جدة", "الأحساء", "القصيم", "الدرعية",
];
const PRINT = Array.from({ length: 9 }, (_, p) =>
  Array.from({ length: 64 }, (_, i) => PRINT_WORDS[(p * 7 + i * 5 + ((i * i) % 11)) % PRINT_WORDS.length]).join(" "),
);

interface CelebrationSceneProps {
  dance: DanceDefinition;
  tier: CelebrationTier;
  /** The milestone, in English: "Lesson complete". */
  headline: string;
}

export function CelebrationScene({ dance, tier, headline }: CelebrationSceneProps) {
  const reduced = useReducedMotion();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    if (reduced) return;
    const start = Date.now();
    // Tick at the finer of the two clocks so neither the row nor the drummer
    // lands late.
    const tick = Math.min(dance.beatMs, dance.drumMs);
    const id = window.setInterval(() => setElapsed(Date.now() - start), tick);
    return () => window.clearInterval(id);
  }, [reduced, dance.beatMs, dance.drumMs]);

  const art = DANCE_ART[dance.id];
  const frame = poseAt(dance, elapsed);
  const showDrummer = tier !== "small" && art.drummer.length > 0;

  return (
    <div
      className="cel-stage"
      role="img"
      aria-label={`${dance.gloss}, a dance from ${dance.region}`}
      data-testid="celebration-scene"
    >
      <div className="cel-news" aria-hidden="true" lang="ar">
        {PRINT.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
      <div className="cel-grid" aria-hidden="true" />
      <div className="cel-circle" aria-hidden="true" />
      <NajdiFrame title={dance.title} className="cel-frame" />
      <span className="cel-caption" aria-hidden="true">
        {dance.gloss} · {dance.region}
      </span>
      <div className="cel-tape cel-tape-1" aria-hidden="true" />
      <div className="cel-tape cel-tape-2" aria-hidden="true" />

      {showDrummer && (
        <div className="cel-figure cel-drummer" aria-hidden="true">
          {art.drummer.map((src, i) => (
            <img
              key={src}
              src={src}
              alt=""
              data-pose={i}
              style={{ visibility: i === frame.drummerPose ? "visible" : "hidden" }}
            />
          ))}
        </div>
      )}

      {/* The sway tilts the whole row from side to side. No keyframe shows
          it (the reference README describes it from clip_ardah3), so it is a
          plain rigid tilt with placeholder timing; see ARDAH_SWAY_*. */}
      <div
        className={`cel-figure cel-row ${reduced ? "" : "cel-sway"}`}
        style={
          {
            "--cel-sway-deg": `${dance.swayDeg}deg`,
            "--cel-sway-ms": `${dance.swayPeriodMs}ms`,
          } as CSSProperties
        }
        aria-hidden="true"
      >
        <div
          className={`cel-row-still ${frame.step === 0 || reduced ? "" : frame.step % 2 ? "cel-pop-a" : "cel-pop-b"}`}
          style={{ transform: `translateX(${frame.shiftPct}%) rotate(${frame.rotateDeg}deg)` }}
        >
          {art.row.map((src, i) => (
            <img
              key={src}
              src={src}
              alt=""
              data-pose={i}
              style={{ visibility: i === frame.pose ? "visible" : "hidden" }}
            />
          ))}
        </div>
      </div>

      <div className="cel-labels" aria-hidden="true">
        <span className="cel-label cel-praise" lang="ar" dir="rtl">
          {dance.praise}
        </span>
        <span className="cel-label cel-headline">{headline}</span>
      </div>
      <div className="cel-grain" aria-hidden="true" />
    </div>
  );
}
