import { Layers, Sparkles } from "lucide-react";
import { useReviewStyle } from "@/hooks/useReviewStyle";
import type { ReviewStyle } from "@/lib/reviewStyle";
import { cn } from "@/lib/utils";

const OPTIONS: Array<{ value: ReviewStyle; label: string; icon: typeof Layers; title: string }> = [
  { value: "flashcards", label: "Flip", icon: Layers, title: "Flashcards: flip the card and rate yourself" },
  { value: "quiz", label: "Quiz", icon: Sparkles, title: "Quiz: answer questions and the app rates you" },
];

/**
 * The "how you review" switch in a review page's header.
 *
 * The same preference as Settings → Review Preferences, surfaced where the
 * decision is actually made: mid-session, when a learner finds the flip card
 * is not what they wanted today. There is no session-only state to explain —
 * a tap here is the setting, and it follows them to the next device.
 */
export const ReviewStyleSwitch = ({ className }: { className?: string }) => {
  const { style, setStyle } = useReviewStyle();
  return (
    <div
      role="radiogroup"
      aria-label="How you review"
      className={cn("inline-flex items-center rounded-lg border border-border bg-card p-0.5", className)}
    >
      {OPTIONS.map(({ value, label, icon: Icon, title }) => {
        const active = style === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={title}
            onClick={() => setStyle(value)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
};
