import { useEffect, useState } from "react";
import { useReducedMotion } from "@/lib/uiPrefs";
import { poseAt, type CelebrationTier, type DanceDefinition } from "@/lib/celebrations";
import { DANCE_ART } from "./danceArt";
import { NajdiFrame } from "./NajdiFrame";
import "./celebration.css";

/**
 * The collage stage: a grayscale cutout dancer snapping from pose to pose on
 * the beat, over mustard paper with faint print, an oxblood circle, a scrap of
 * grid paper, tape, and the dance's name in a Najdi frame. Only the dancers
 * are pictures; everything else is drawn here so it stays on-brand.
 *
 * Under reduced motion it holds the first pose, which `poseAt` keeps untilted.
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
    // Half a beat: the drummer moves on every half, the dancer on every beat.
    const id = window.setInterval(() => setElapsed(Date.now() - start), dance.beatMs / 2);
    return () => window.clearInterval(id);
  }, [reduced, dance.beatMs]);

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

      <div
        className={`cel-figure cel-dancer ${frame.step === 0 || reduced ? "" : frame.step % 2 ? "cel-pop-a" : "cel-pop-b"}`}
        style={{ transform: `translateX(${frame.shiftPct}%) rotate(${frame.rotateDeg}deg)` }}
        aria-hidden="true"
      >
        {art.dancer.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            data-pose={i}
            style={{ visibility: i === frame.pose ? "visible" : "hidden" }}
          />
        ))}
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
