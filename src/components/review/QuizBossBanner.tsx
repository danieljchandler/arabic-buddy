import { Crown, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface QuizBossBannerProps {
  /** How often the word has been missed, on either schedule. */
  lapses: number;
  /** The learner's memory hook for it, if they have one. */
  mnemonic?: string | null;
  /** The hook's picture, else the word's own. */
  pictureUrl?: string | null;
  /** The card has been answered: the hook and its picture are shown, as the lesson. */
  answered: boolean;
  /** The hook is open. */
  hookOpen: boolean;
  /** Open the hook; before the answer that is help. */
  onOpenHook: () => void;
  className?: string;
}

/**
 * The boss card's header (quiz Phase 7): the session opens on the learner's
 * most-missed card due, and says so.
 *
 * Its memory hook and its picture are one tap away, together, and opening
 * them before answering is help, as opening the sentence is. They are not in
 * view from the start because either can be the answer: a picture beside "what
 * does it mean?" is the meaning, and a drawing of the hook is the hook. After
 * the answer both are shown anyway, since a card missed this often is one to
 * learn again rather than only to grade.
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
  const shown = hookOpen || answered;
  const hasAid = !!hook || !!pictureUrl;
  return (
    <section
      aria-label="Boss card"
      className={cn("rounded-2xl border border-primary/30 bg-primary/5 p-4 mb-4 text-center", className)}
    >
      <p className="flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
        <Crown className="h-3.5 w-3.5" aria-hidden />
        Boss card
      </p>
      <p className="text-sm text-muted-foreground mt-1">
        Your most-missed card due today: missed {lapses === 1 ? "once" : `${lapses} times`}. Beat it to open the
        session.
      </p>
      {hasAid && !shown && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenHook}
          aria-expanded={false}
          className="mt-2 gap-1.5 text-muted-foreground"
        >
          <Lightbulb className="h-4 w-4" />
          {hook ? "Show your memory hook" : "Show its picture"}
        </Button>
      )}
      <div aria-live="polite">
        {hasAid && shown && (
          <div className="animate-in fade-in duration-200">
            {pictureUrl && (
              <div className="mt-3 mx-auto max-w-[12rem] rounded-lg overflow-hidden bg-muted aspect-[4/3]">
                <img src={pictureUrl} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            {hook && <p className="mt-3 text-sm text-foreground italic">{hook}</p>}
          </div>
        )}
      </div>
    </section>
  );
};
