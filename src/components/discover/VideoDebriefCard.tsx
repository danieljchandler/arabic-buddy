import { Link } from "react-router-dom";
import { ArrowRight, Lock, MessagesSquare } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import { FEATURE_REQUIREMENTS } from "@/lib/featureAccess";

interface VideoDebriefCardProps {
  videoId: string;
  /** Words saved on this visit, for the card's promise. */
  savedCount: number;
}

/**
 * The way from a video into its debrief.
 *
 * Always on screen under the video rather than appearing when it ends: a
 * learner coming back to a clip they watched yesterday should not have to sit
 * through it again to be quizzed on it. A free learner still sees it, marked
 * as a paid feature, and lands on the paywall rather than on nothing.
 */
export function VideoDebriefCard({ videoId, savedCount }: VideoDebriefCardProps) {
  const { hasAccess, loading } = useSubscription();
  const locked = !loading && !hasAccess(FEATURE_REQUIREMENTS.video_debrief);
  const promise =
    savedCount > 0
      ? `A few questions on what happened, a quiz on the ${savedCount} word${savedCount === 1 ? "" : "s"} you saved, and a line or two to say aloud.`
      : "A few questions on what happened, the words you weren't sure of, and a line or two to say aloud.";

  return (
    <Link
      to={`/debrief/${videoId}`}
      className="group flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.04] p-3 transition-colors hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      data-testid="video-debrief-card"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <MessagesSquare className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          Check what you understood
          {locked && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Lock className="h-2.5 w-2.5" aria-hidden />
              Premium
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{promise}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
        Quiz me
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}
