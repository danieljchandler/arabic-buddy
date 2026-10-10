import { Crown, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface QuizBossBannerProps {
  /** How often the word has been missed on this schedule. */
  lapses: number;
  /** The learner's memory hook for it, if they have one. */
  mnemonic?: string | null;
  /** The hook's picture, else the word's own. */
  pictureUrl?: string | null;
  /** The card has been answered: the hook is shown, as the lesson. */
  answered: boolean;
  /** The hook is open. */
  hookOpen: boolean;
  /** Open the hook; before the answer that is help. */
  onOpenHook: () => void;
  className?: string;
}

/**
 * The boss card's header (quiz Phase 7): the session opens on the learner's
 * worst word, and says so. Its picture is in view and its memory hook a tap
 * away; opening the hook before answering is help, as opening the sentence
 * is, and after the answer the hook is shown anyway, since a word missed this
 * often is one to learn again rather than only to grade.
 */
export const QuizBossBanner = ({
  lapses,
  mnemonic,
  pictureUrl,
  answered,
  hookOpen,
  onOpenHook,
  className,
}: QuizBossBannerProps) => {
  const hook = mnemonic?.trim() || null;
  return (
    <section
      aria-label="Boss card"
      className={cn("rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 mb-4 text-center", className)}
    >
      <p className="flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        <Crown className="h-3.5 w-3.5" aria-hidden />
        Boss card
      </p>
      <p className="text-sm text-muted-foreground mt-1">
        Your toughest word: missed {lapses === 1 ? "once" : `${lapses} times`}. Beat it to open the session.
      </p>
      {pictureUrl && (
        <div className="mt-3 mx-auto max-w-[12rem] rounded-lg overflow-hidden bg-muted aspect-[4/3]">
          <img src={pictureUrl} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      {hook &&
        (hookOpen || answered ? (
          <p className="mt-3 text-sm text-foreground italic animate-in fade-in duration-200">{hook}</p>
        ) : (
          <Button variant="ghost" size="sm" onClick={onOpenHook} className="mt-2 gap-1.5 text-muted-foreground">
            <Lightbulb className="h-4 w-4" />
            Show your memory hook
          </Button>
        ))}
    </section>
  );
};
