import { cn } from "@/lib/utils";
import {
  comprehensionBarClass,
  comprehensionLabel,
  type Comprehension,
} from "@/lib/comprehension";

/**
 * How much of this piece of content the learner already knows.
 *
 * The same bar on every surface that lists content — Discover, Listen, the
 * Reading Library — because the whole point of the measure is that a learner
 * can compare a video against a story against an episode and pick the one
 * that is a stretch rather than a wall. It was inline markup on Discover
 * before the other two surfaces got it; it lives here so the three cannot
 * drift apart.
 */
export function ComprehensionBar({
  comprehension,
  className,
}: {
  comprehension: Comprehension;
  className?: string;
}) {
  const percent = Math.round(comprehension.coverage * 100);
  return (
    <div className={cn("mb-2", className)}>
      <div className="mb-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{comprehensionLabel(comprehension.band)}</span>
        <span>{percent}% words you know</span>
      </div>
      <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full transition-all", comprehensionBarClass(comprehension.band))}
          /* Floor the width so a very low score still reads as a bar rather
             than an empty track the learner mistakes for "not measured". */
          style={{ width: `${Math.max(6, percent)}%` }}
        />
      </div>
    </div>
  );
}
