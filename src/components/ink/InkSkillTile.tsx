import { Link } from "react-router-dom";
import type { Skill } from "@/lib/surfaces";
import { cn } from "@/lib/utils";
import { InkWaveform } from "./InkWaveform";

/**
 * A chooser skill tile in the Ink direction: type-led, no illustration.
 *
 * The default tile is a watercolour scene over a cream plate. Ink has no
 * pictures, so each skill is its own Arabic word, set big in Rakkas with the
 * kashida drawn out (استمـــاع, قـــراءة, تحـــدّث, كتـــابة), an index numeral, and
 * one small motif for what the skill does — a voice for listening, lines of
 * text with a highlighter stroke for reading, a voice tapering off for
 * speaking, a pen line for writing. Four grounds — ink, paper, oxblood and
 * paper-2 — so no two neighbours match, as in the Ink-Choose artboard.
 *
 * What the default tile guarantees, this keeps: the same link target, the
 * visible English label (the chrome speaks English, and e2e finds the tiles
 * by it), and an accessible name of the label plus the plain Arabic word.
 * The stretched display word is hidden from screen readers — a tatweel is a
 * drawing, not a letter — and read out in its plain spelling instead.
 *
 * Dark grounds are fixed hex (dark in both themes, cream type on them); the
 * light ones are tokens so night mode turns them dark too. Every text pairing
 * clears 4.5:1 (mustard on oxblood is the tightest, at 6.7:1).
 */

type Ground = "ink" | "paper" | "oxblood" | "paper-2";

const GROUNDS: readonly Ground[] = ["ink", "paper", "oxblood", "paper-2"];

export interface InkSkillTileProps {
  skill: Skill;
  /** Position on the chooser, 0-based: sets the numeral and the ground. */
  index: number;
}

export function InkSkillTile({ skill, index }: InkSkillTileProps) {
  const ground = GROUNDS[index % GROUNDS.length];
  const numeral = String(index + 1).padStart(2, "0");
  const dark = ground === "ink" || ground === "oxblood";

  return (
    <Link
      to={skill.to}
      data-ink-tile={ground}
      className={cn(
        "relative block aspect-[4/3.4] overflow-hidden rounded-[4px]",
        "transition-transform active:scale-[0.98]",
        ground === "ink" && "bg-[#1A1C17] text-[#EFE6CF]",
        ground === "oxblood" && "bg-[#6B1F1F] text-[#EFE6CF]",
        ground === "paper" && "border border-border bg-card text-foreground",
        ground === "paper-2" && "bg-muted text-foreground",
      )}
    >
      {dark ? (
        <DarkPanel ground={ground} numeral={numeral} />
      ) : (
        <LightMotif ground={ground} numeral={numeral} label={skill.label} />
      )}

      <span
        aria-hidden="true"
        lang="ar"
        dir="rtl"
        className={cn(
          "font-ink-display pointer-events-none absolute right-2.5 whitespace-nowrap text-[30px]",
          dark ? "top-[42%] text-[#E2B65C]" : "bottom-1",
          ground === "paper-2" && "text-primary",
        )}
      >
        {skill.arabicDisplay}
      </span>

      {dark && (
        <span className="absolute bottom-2.5 left-3 text-[13px] font-medium leading-tight">{skill.label}</span>
      )}
      <span lang="ar" className="sr-only">
        {skill.arabic}
      </span>
    </Link>
  );
}

/** The top of a dark tile: a panel in the other dark, with sadu pressed in. */
function DarkPanel({ ground, numeral }: { ground: "ink" | "oxblood"; numeral: string }) {
  // Ink tile, oxblood panel (Listen); oxblood tile, ink panel (Speak).
  const onInk = ground === "ink";
  return (
    <>
      <span
        aria-hidden="true"
        data-ink-sadu=""
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-[60%]",
          onInk ? "bg-[#6B1F1F]" : "bg-[#1A1C17]",
        )}
      >
        {onInk ? (
          // Listening: a whole phrase, heard.
          <InkWaveform className="absolute left-3 right-3 top-9 h-6 text-[#E2B65C]" />
        ) : (
          // Speaking: one strong bar, then your voice trailing after it.
          <span className="absolute left-3 top-9 flex h-7 items-end gap-[3px]">
            <i className="block h-full w-[3px] bg-[#E2B65C]" />
            <i className="block h-[72%] w-[3px] bg-[#EFE6CF]/35" />
            <i className="block h-[46%] w-[3px] bg-[#EFE6CF]/35" />
            <i className="block h-[26%] w-[3px] bg-[#EFE6CF]/35" />
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-2 top-2 rounded-[2px] px-1.5 py-0.5 text-[10px] font-medium tracking-[0.14em] tabular-nums",
          onInk ? "bg-[#1A1C17]" : "bg-[#6B1F1F]",
        )}
      >
        {numeral}
      </span>
    </>
  );
}

/** A light tile: numeral and label on top, the skill's motif in the middle. */
function LightMotif({
  ground,
  numeral,
  label,
}: {
  ground: "paper" | "paper-2";
  numeral: string;
  label: string;
}) {
  return (
    <>
      {ground === "paper-2" && (
        // A cropped giant ك, tone on tone: drawn as SVG so it is artwork, not
        // text, and the contrast audit does not read it as a failing label.
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 100 100"
          className="pointer-events-none absolute -left-4 -top-10 h-[150%] w-auto text-foreground opacity-[0.07]"
        >
          <text x="50" y="72" textAnchor="middle" fontSize="96" fill="currentColor" className="font-ink-display">
            ك
          </text>
        </svg>
      )}
      <span className="relative flex items-center justify-between px-3 pt-2.5">
        <span aria-hidden="true" className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground tabular-nums">
          {numeral}
        </span>
        <span className="text-[13px] font-medium leading-tight">{label}</span>
      </span>
      {ground === "paper" ? (
        // Reading: lines of text, one of them under a highlighter.
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-3 top-[34%] flex flex-col items-end gap-[5px]">
          <i className="block h-[3px] w-full bg-foreground" />
          <i className="block h-[3px] w-[82%] bg-foreground" />
          <i className="block h-2 w-[94%] bg-[#E2B65C]" />
          <i className="block h-[3px] w-[60%] bg-foreground" />
          <i className="block h-[3px] w-[76%] bg-foreground/30" />
        </span>
      ) : (
        // Writing: a pen line written right to left on a dotted baseline.
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 145 36"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-x-3 top-[34%] h-9 w-[calc(100%-1.5rem)] text-primary"
        >
          <path d="M2 32 H143" className="stroke-foreground/35" strokeWidth="1" strokeDasharray="3 3" />
          <path
            d="M143 24 H112 L106 12 L100 30 L94 6 L88 32 L82 14 L76 26 L70 20 H40"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="40" cy="20" r="3.5" fill="currentColor" />
        </svg>
      )}
    </>
  );
}
