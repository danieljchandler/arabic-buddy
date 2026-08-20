import { useNavigate } from "react-router-dom";
import caughtUpArt from "@/assets/illustrations/empty-caught-up.webp";
import { SparkleBurst } from "@/components/gamification/SparkleBurst";
import { Button } from "@/components/ui/button";
import type { ReviewDeckId, ReviewSession } from "@/hooks/useReviewSession";

interface SessionHandoffProps {
  /** The deck the learner just finished. */
  deckId: ReviewDeckId;
  session: ReviewSession;
  /** Shown when this deck has nothing due. */
  message: string;
  /** Where "done" goes once every deck is clear. */
  fallbackLabel: string;
  fallbackRoute: string;
  /** Optional extra content (e.g. per-deck stats) above the action button. */
  children?: React.ReactNode;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * End-of-deck state for a review session. When another deck still has cards
 * due, this offers to continue into it so the learner clears everything due in
 * one sitting instead of dead-ending on "All caught up" while cards wait in a
 * deck they'd have to remember to visit.
 */
export const SessionHandoff = ({
  deckId,
  session,
  message,
  fallbackLabel,
  fallbackRoute,
  children,
}: SessionHandoffProps) => {
  const navigate = useNavigate();
  const next = session.nextDeck(deckId);

  return (
    <div className="relative text-center max-w-sm mx-auto py-12">
      {/* Finishing a deck is the day's reward moment — let it sparkle once. */}
      {!next && <SparkleBurst />}
      <img
        src={caughtUpArt}
        alt=""
        aria-hidden
        draggable={false}
        className="h-32 w-32 mx-auto mb-6 rounded-full object-cover bg-card-cream ring-1 ring-border/60 shadow-soft select-none animate-scale-in"
      />
      <h1 className="text-xl font-bold text-foreground mb-3">
        {next ? "Deck complete" : "All caught up!"}
      </h1>
      <p className="text-muted-foreground mb-8">
        {next
          ? `${message} ${plural(next.due, next.cardNoun)} still due in ${next.label}.`
          : message}
      </p>

      {children}

      {next ? (
        <Button onClick={() => navigate(next.route)}>
          Continue with {plural(next.due, next.cardNoun)}
        </Button>
      ) : (
        <Button onClick={() => navigate(fallbackRoute)}>{fallbackLabel}</Button>
      )}
    </div>
  );
};
