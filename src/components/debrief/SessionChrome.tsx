import { useMemo, useState } from "react";
import { Check, Loader2, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { fetchSpeechBlob } from "@/lib/speakArabic";
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

/** Read the Arabic in a tutor message aloud, in the session's dialect. Renders nothing for a message with no Arabic. */
export function ListenButton({ text, dialect }: { text: string; dialect: string }) {
  const [playing, setPlaying] = useState(false);
  const arabic = useMemo(() => extractArabicRuns(text).join("، "), [text]);
  if (!arabic) return null;

  const play = async () => {
    if (playing) return;
    setPlaying(true);
    try {
      const blob = await fetchSpeechBlob({ text: arabic, dialect });
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      toast.error("Couldn't play the audio");
    } finally {
      setPlaying(false);
    }
  };

  return (
    <button
      type="button"
      onClick={play}
      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
    >
      {playing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Volume2 className="h-3 w-3" />}
      Listen to the Arabic
    </button>
  );
}
