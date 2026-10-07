import { useEffect, useState, type CSSProperties } from "react";
import type { DialectModule } from "@/contexts/DialectContext";
import { useReducedMotion } from "@/lib/uiPrefs";
import { poseAt, type DanceDefinition } from "@/lib/dances";
import type { CelebrationBadge, CelebrationTier } from "@/lib/celebrations";
import { artFor, type StageBox } from "./danceArt";
import { BadgeName, BadgeSticker } from "./BadgeSticker";
import { StageEffects } from "./StageEffects";
import { DialectFrame } from "./DialectFrame";
import "./celebration.css";

/**
 * The collage stage (it plays a vignette, `@/lib/vignettes`, exactly as it
 * plays a dance; a vignette's flames and sparkle are `StageEffects`): grayscale cutout dancers snapping from pose to pose and
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
  /**
   * False holds the first pose: the scene waits for its music to start, so
   * the first pose falls on the first beat (useDanceMusic). Defaults to true.
   */
  running?: boolean;
  /** The badge this celebration is for, stuck on the stage. */
  badge?: CelebrationBadge;
}

export function CelebrationScene({ dance, dialect, tier, cheer, headline, running = true, badge }: CelebrationSceneProps) {
  const reduced = useReducedMotion();
  const [elapsed, setElapsed] = useState(0);
  const beatMs = dance?.beatMs ?? 0;
  const musicianMs = dance?.musicianMs ?? 0;

  useEffect(() => {
    setElapsed(0);
    if (reduced || !beatMs || !running) return;
    const start = Date.now();
    // Tick at the finer of the two clocks so neither the dancers nor the
    // musician lands late.
    const tick = Math.min(beatMs, musicianMs || beatMs);
    const id = window.setInterval(() => setElapsed(Date.now() - start), tick);
    return () => window.clearInterval(id);
  }, [reduced, beatMs, musicianMs, running]);

  const art = dance ? artFor(dance.id) : null;
  const frame = dance ? poseAt(dance, elapsed) : null;
  const posesUsed = new Set(dance?.sequence ?? []);
  const showMusician = !!art && tier !== "small" && art.musician.length > 0;
  const print = printFor(dialect);

  return (
    <div
      className={`cel-stage ${dance ? "" : "cel-stage-bare"} ${badge ? "cel-has-badge" : ""}`}
      {...(dance
        ? { role: "img", "aria-label": `${dance.gloss}, ${dance.about ?? `a dance from ${dance.region}`}` }
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
          shows the bodies mid-sway), and the bob drops them on each step;
          see each dance's *_SWAY_* and *_BOB_* constants. */}
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
            className={`cel-bobber ${reduced || !dance.bobPct ? "" : "cel-bob"}`}
            style={
              {
                "--cel-bob-pct": `${dance.bobPct}%`,
                "--cel-bob-ms": `${dance.bobPeriodMs}ms`,
              } as CSSProperties
            }
          >
            <div
              className={`cel-dancers-still ${frame.swapStep === 0 || reduced ? "" : frame.swapStep % 2 ? "cel-pop-a" : "cel-pop-b"}`}
              style={{ transform: `translateX(${frame.shiftPct}%) rotate(${frame.rotateDeg}deg)` }}
            >
              {art.dancers.map((src, i) =>
                // A streak ladder's rung shows two or three of its six stills:
                // the others are never needed, so they are never fetched.
                posesUsed.has(i) ? (
                  <img
                    key={src}
                    src={src}
                    alt=""
                    data-pose={i}
                    style={{ visibility: i === frame.pose ? "visible" : "hidden" }}
                  />
                ) : null,
              )}
            </div>
          </div>
        </div>
      )}

      {dance && art && dance.effects && dance.effects.length > 0 && (
        <StageEffects
          effects={dance.effects}
          heat={dance.heat ?? 2}
          anchor={dance.fxAnchor ?? { x: 50, y: 60 }}
          reduced={reduced}
          style={boxStyle("dancers", art.dancersBox)}
        />
      )}

      {badge && <BadgeSticker badge={badge} />}

      <div className="cel-labels" aria-hidden="true">
        <span className="cel-label cel-praise" lang="ar" dir="rtl">
          {cheer}
        </span>
        <span className="cel-label cel-headline">{headline}</span>
        {badge && <BadgeName badge={badge} />}
      </div>
      <div className="cel-grain" aria-hidden="true" />
    </div>
  );
}
