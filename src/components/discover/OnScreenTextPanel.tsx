import { MonitorPlay } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScreenTextLine } from "@/lib/onScreenText";

const ARABIC_FONT = "'Noto Naskh Arabic', 'Noto Sans Arabic', serif";

interface OnScreenTextPanelProps {
  lines: ScreenTextLine[];
  /** Hidden when the learner has translations switched off. */
  showTranslations?: boolean;
  /** Jump the player to an overlay's moment, when the player supports it. */
  onSeek?: (seconds: number) => void;
  className?: string;
}

/**
 * The text written on the video, shown above the transcript.
 *
 * It sits above rather than inside the transcript because it is a different
 * kind of evidence: a POV caption or a title card is the setup a learner needs
 * BEFORE the first spoken line makes sense, and it is not something anybody
 * said. Folding it into the transcript — which is what the pipeline used to do
 * — puts words in a speaker's mouth and breaks line-by-line playback, because
 * there is no audio at that timestamp to play.
 */
export const OnScreenTextPanel = ({
  lines,
  showTranslations = true,
  onSeek,
  className,
}: OnScreenTextPanelProps) => {
  if (lines.length === 0) return null;

  return (
    <section
      aria-label="Text on screen"
      className={cn(
        "border-b border-amber-200/70 dark:border-amber-800/40 bg-amber-50/70 dark:bg-amber-950/20 px-4 py-3",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <MonitorPlay className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
          Text on screen
        </h2>
        <span className="text-xs text-amber-700/70 dark:text-amber-400/70">
          ({lines.length})
        </span>
      </div>

      {/* Bounded: the transcript below it is the scrolling pane, and a video
          with a dozen overlays would otherwise push it off the screen. */}
      <ul className="space-y-2 max-h-40 overflow-y-auto">
        {lines.map((line) => {
          const seekable = onSeek && line.startSeconds !== undefined;
          const body = (
            <>
              <p
                dir="rtl"
                className="text-base font-medium text-foreground"
                style={{ fontFamily: ARABIC_FONT }}
              >
                {line.text}
              </p>
              {line.translation && showTranslations && (
                <p className="mt-0.5 text-xs text-muted-foreground">{line.translation}</p>
              )}
              {line.confidence === "low" && (
                <p className="mt-0.5 text-xs italic text-amber-700/80 dark:text-amber-400/80">
                  partly legible
                </p>
              )}
            </>
          );

          return (
            <li key={line.id}>
              {seekable ? (
                <button
                  type="button"
                  onClick={() => onSeek!(line.startSeconds!)}
                  className="w-full rounded-lg p-2 text-left transition-colors hover:bg-amber-100/70 dark:hover:bg-amber-900/30"
                >
                  {body}
                </button>
              ) : (
                <div className="rounded-lg p-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default OnScreenTextPanel;
