import { useState } from "react";
import { Volume2, ChevronDown } from "lucide-react";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useDialect } from "@/contexts/DialectContext";
import { cn } from "@/lib/utils";
import type { SoundSpotlightEntry } from "@/hooks/useTopic";

interface Props {
  entries: SoundSpotlightEntry[];
}

/**
 * The lesson's pronunciation notes.
 *
 * Authored in the lesson spreadsheet's "SOUND SPOTLIGHT" section, parsed by
 * parseLessonXlsx since it was written, and — until now — thrown away at import
 * and rendered nowhere. Of the six plan sections this is the one that is
 * genuinely teaching content rather than production metadata, which is why it
 * gets a learner-facing surface and image_scenes / flashcard_spec /
 * design_rationale do not.
 */
const SoundRow = ({ entry }: { entry: SoundSpotlightEntry }) => {
  const { activeDialect } = useDialect();
  const example = entry.example?.trim();

  // Only synthesise when there's an Arabic example worth hearing.
  const { ttsUrl } = useAzureTTS({
    text: example ?? "",
    skip: !example,
    dialect: activeDialect,
  });
  const { play } = useAudioPlayer();

  return (
    <li className="flex items-start gap-3 py-2">
      <span
        className="shrink-0 text-xl font-bold text-primary min-w-[2ch] text-center"
        dir="rtl"
        style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
      >
        {entry.sound}
      </span>
      <div className="flex-1 min-w-0">
        {example && (
          <div className="flex items-center gap-2">
            <span
              className="text-base text-foreground"
              dir="rtl"
              style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
            >
              {example}
            </span>
            {ttsUrl && (
              <button
                type="button"
                onClick={() => play(ttsUrl)}
                aria-label={`Play ${example}`}
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                <Volume2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        {entry.explanation && (
          <p className="text-xs text-muted-foreground leading-relaxed">{entry.explanation}</p>
        )}
      </div>
    </li>
  );
};

export const SoundSpotlight = ({ entries }: Props) => {
  const [open, setOpen] = useState(true);
  const usable = entries.filter((e) => e.sound || e.example || e.explanation);
  if (usable.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Sounds in this lesson
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <ul className="px-4 pb-3 divide-y divide-border/60">
          {usable.map((entry, i) => (
            <SoundRow key={`${entry.sound ?? "sound"}-${i}`} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
};
