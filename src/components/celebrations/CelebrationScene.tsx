import { useEffect, useState, type CSSProperties } from "react";
import type { DialectModule } from "@/contexts/DialectContext";
import { useReducedMotion } from "@/lib/uiPrefs";
import { poseAt, type DanceDefinition } from "@/lib/dances";
import type { CelebrationTier } from "@/lib/celebrations";
import { DANCE_ART, type StageBox } from "./danceArt";
import { DialectFrame } from "./DialectFrame";
import "./celebration.css";

/**
 * The collage stage: grayscale cutout dancers snapping from pose to pose and
 * swaying together, a musician in the open space they face, over mustard
 * paper with faint print, an oxblood circle, a scrap of grid paper, tape, and
 * the dance's name in a frame from the dialect's architecture (DialectFrame).
 * Only the performers are pictures; everything else is drawn here so it stays
 * on-brand.
 *
 * With no dance (a dialect whose dances aren't drawn yet) it is the paper,
 * the circle and the labels. Under reduced motion it holds the first pose,
 * which `poseAt` keeps untilted, and nothing sways.
 */

// Faint print for the paper: dance and place names only, so there is no
// sentence in it to get wrong.
const PRINT_WORDS: Record<DialectModule, readonly string[]> = {
  Gulf: [
    "العرضة", "نجد", "الرياض", "الطبل", "السيف", "القصيد", "الصف", "الراية",
    "العيالة", "الرزحة", "المزمار", "الحجاز", "جدة", "الأحساء", "القصيم", "الدرعية",
  ],
  Egyptian: [
    "التحطيب", "التنورة", "العصاية", "الصعيد", "الأقصر", "أسوان", "القاهرة", "المزمار",
    "الطبلة", "المولد", "النيل", "قنا", "سوهاج", "المنيا", "الحسين", "الزفة",
  ],
  Yemeni: [
    "البرع", "صنعاء", "حراز", "الجنبية", "الطاسة", "المرفع", "تعز", "إب",
    "حضرموت", "الزفين", "ذمار", "مأرب", "عدن", "القمرية", "الشرح", "تهامة",
  ],
};

function printFor(dialect: DialectModule): string[] {
  const words = PRINT_WORDS[dialect];
  return Array.from({ length: 9 }, (_, p) =>
    Array.from({ length: 64 }, (_, i) => words[(p * 7 + i * 5 + ((i * i) % 11)) % words.length]).join(" "),
  );
}

const boxStyle = (name: "dancers" | "musician", box: StageBox | undefined): CSSProperties =>
  box
    ? ({
        [`--cel-${name}-left`]: `${box.left}%`,
        [`--cel-${name}-width`]: `${box.width}%`,
        [`--cel-${name}-height`]: `${box.height}%`,
      } as CSSProperties)
    : {};

interface CelebrationSceneProps {
  /** The dance, or null for a dialect whose dances aren't drawn yet. */
  dance: DanceDefinition | null;
  /** Whose paper: the print is that dialect's dance and place names. */
  dialect: DialectModule;
  tier: CelebrationTier;
  /** The cheer, in the dialect: "كفو!". */
  cheer: string;
  /** The milestone, in English: "Lesson complete!". */
  headline: string;
}

export function CelebrationScene({ dance, dialect, tier, cheer, headline }: CelebrationSceneProps) {
  const reduced = useReducedMotion();
  const [elapsed, setElapsed] = useState(0);
  const beatMs = dance?.beatMs ?? 0;
  const musicianMs = dance?.musicianMs ?? 0;

  useEffect(() => {
    setElapsed(0);
    if (reduced || !beatMs) return;
    const start = Date.now();
    // Tick at the finer of the two clocks so neither the dancers nor the
    // musician lands late.
    const tick = Math.min(beatMs, musicianMs || beatMs);
    const id = window.setInterval(() => setElapsed(Date.now() - start), tick);
    return () => window.clearInterval(id);
  }, [reduced, beatMs, musicianMs]);

  const art = dance ? DANCE_ART[dance.id] : null;
  const frame = dance ? poseAt(dance, elapsed) : null;
  const showMusician = !!art && tier !== "small" && art.musician.length > 0;
  const print = printFor(dialect);

  return (
    <div
      className={`cel-stage ${dance ? "" : "cel-stage-bare"}`}
      {...(dance
        ? { role: "img", "aria-label": `${dance.gloss}, a dance from ${dance.region}` }
        : { "aria-hidden": true })}
      data-testid="celebration-scene"
    >
      <div className="cel-news" aria-hidden="true" lang="ar">
        {print.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
      <div className="cel-grid" aria-hidden="true" />
      <div className="cel-circle" aria-hidden="true" />
      {dance && (
        <>
          <DialectFrame dialect={dance.dialect} title={dance.title} className="cel-frame" />
          <span className="cel-caption" aria-hidden="true">
            {dance.gloss} · {dance.region}
          </span>
        </>
      )}
      <div className="cel-tape cel-tape-1" aria-hidden="true" />
      <div className="cel-tape cel-tape-2" aria-hidden="true" />

      {art && frame && showMusician && (
        <div className="cel-figure cel-musician" style={boxStyle("musician", art.musicianBox)} aria-hidden="true">
          {art.musician.map((src, i) => (
            <img
              key={src}
              src={src}
              alt=""
              data-pose={i}
              style={{ visibility: i === frame.musicianPose ? "visible" : "hidden" }}
            />
          ))}
        </div>
      )}

      {/* The sway tilts the dancers as one, a plain rigid tilt (no keyframe
          shows the bodies mid-sway); see each dance's *_SWAY_* constants. */}
      {dance && art && frame && (
        <div
          className={`cel-figure cel-dancers ${reduced || !dance.swayDeg ? "" : "cel-sway"}`}
          style={
            {
              ...boxStyle("dancers", art.dancersBox),
              "--cel-sway-deg": `${dance.swayDeg}deg`,
              "--cel-sway-ms": `${dance.swayPeriodMs}ms`,
            } as CSSProperties
          }
          aria-hidden="true"
        >
          <div
            className={`cel-dancers-still ${frame.swapStep === 0 || reduced ? "" : frame.swapStep % 2 ? "cel-pop-a" : "cel-pop-b"}`}
            style={{ transform: `translateX(${frame.shiftPct}%) rotate(${frame.rotateDeg}deg)` }}
          >
            {art.dancers.map((src, i) => (
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
      )}

      <div className="cel-labels" aria-hidden="true">
        <span className="cel-label cel-praise" lang="ar" dir="rtl">
          {cheer}
        </span>
        <span className="cel-label cel-headline">{headline}</span>
      </div>
      <div className="cel-grain" aria-hidden="true" />
    </div>
  );
}
