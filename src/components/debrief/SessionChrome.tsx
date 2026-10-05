import { useMemo } from "react";
import { Check, Loader2, Square, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { useLineAudio } from "@/hooks/useLineAudio";
import { cn } from "@/lib/utils";
import { extractArabicRuns } from "../../../supabase/functions/_shared/arabicReviewCore";

/**
 * The chrome a guided tutor session shares — the step checklist across the
 * top and the "listen" link under a tutor message. First written for the
 * post-video debrief; the daily recap runs the same shape of session over a
 * different set of steps, which is why the checklist takes its labels as a
 * prop rather than knowing them.
 */

interface StepChecklistProps<S extends string> {
  steps: S[];
  current: S | null;
  done: Set<S>;
  labels: Record<S, string>;
}

export function StepChecklist<S extends string>({ steps, current, done, labels }: StepChecklistProps<S>) {
  return (
    <ol className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Session steps">
      {steps.map((step, index) => {
        const isDone = done.has(step);
        const isCurrent = step === current;
        return (
          <li
            key={step}
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
              isCurrent && "border-primary bg-primary/10 font-semibold text-primary",
              !isCurrent && isDone && "border-border bg-muted text-muted-foreground",
              !isCurrent && !isDone && "border-border text-muted-foreground",
            )}
          >
            {isDone ? <Check className="h-3 w-3" aria-label="Done" /> : <span aria-hidden>{index + 1}</span>}
            {labels[step]}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Read the Arabic in a tutor message aloud, in the session's dialect. Renders
 * nothing for a message with no Arabic.
 *
 * The runs of Arabic are read one after another through `useLineAudio`
 * rather than joined into one request. The hook spends the tap's user
 * activation on a clip of silence *before* synthesis starts: this button used
 * to create its `Audio` element only once the speech had arrived, which iOS
 * Safari refuses to play — the tap was long over by then — so on a phone the
 * link spun and said nothing. One request per run also keeps each short,
 * where a whole message's Arabic in one call can run past the client's
 * twelve-second TTS timeout; and the clips are kept, so hearing the line
 * again costs nothing from the daily cap.
 *
 * A failure is said out loud here, because this is the only speaker on the
 * screen: a spinner that stops with no sound is indistinguishable from the
 * button not working at all, which is how the bug above was reported.
 */
export function ListenButton({ text, dialect }: { text: string; dialect: string }) {
  const runs = useMemo(() => extractArabicRuns(text), [text]);
  const { playingIndex, loadingIndex, isPlayingAll, playAll } = useLineAudio({
    lines: runs,
    dialect,
    onError: () => toast.error("Couldn't play the audio"),
  });
  if (runs.length === 0) return null;

  const fetching = loadingIndex !== null;
  // `playAll` is a toggle: tapping while it is reading — or still fetching —
  // stops it.
  const sounding = isPlayingAll || playingIndex !== null;

  return (
    <button
      type="button"
      onClick={() => playAll()}
      aria-pressed={sounding}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] transition-colors hover:text-primary",
        sounding ? "text-primary" : "text-muted-foreground",
      )}
    >
      {fetching ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : sounding ? (
        <Square className="h-3 w-3" />
      ) : (
        <Volume2 className="h-3 w-3" />
      )}
      Listen to the Arabic
    </button>
  );
}
