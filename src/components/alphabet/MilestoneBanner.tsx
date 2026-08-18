import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useReducedMotion } from "@/lib/uiPrefs";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "hakiya:alphabet:milestone-seen";

const THRESHOLDS = [7, 14, 21, 28];

function getSeen(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Records the dismissed milestone *and every one below it*.
 *
 * Recording only the threshold that was on screen made the banner count
 * downwards. A learner whose progress arrives in one go — which is what happens
 * on a second device, or on any account restored from the server — is
 * congratulated on 28, dismisses it, and next visit is congratulated on 21.
 * Then 14. Then 7: four celebrations of milestones they passed weeks ago, each
 * a smaller number than the last. Worse, the effect reruns on `masteredCount`,
 * so the next one arrived without even a reload.
 *
 * Marking everything at or below is what "show the highest unseen" already
 * implies: crossing 28 means 21 happened too.
 */
function markSeen(threshold: number) {
  try {
    const cur = new Set(getSeen());
    for (const t of THRESHOLDS) {
      if (t <= threshold) cur.add(t);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...cur]));
  } catch {
    /* ignore */
  }
}

interface Props {
  masteredCount: number;
}

/**
 * One-time celebratory banner shown when the learner crosses 7/14/21/28 mastered letters.
 * Dismissal is remembered in localStorage so the banner doesn't reappear.
 */
export const MilestoneBanner = ({ masteredCount }: Props) => {
  const reduced = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const seen = new Set(getSeen());
    // Show the highest unseen threshold the user has reached
    const candidate = [...THRESHOLDS].reverse().find((t) => masteredCount >= t && !seen.has(t));
    if (candidate) setActive(candidate);
  }, [masteredCount]);

  if (active === null) return null;

  const dismiss = () => {
    markSeen(active);
    setActive(null);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-primary bg-primary/10 px-4 py-3.5",
        // scale-in is the app's arrival motion for a card or badge. The banner
        // used to run a gradient shine on a 2.6s loop, which kept pulling the
        // eye back to a message that had already been read.
        !reduced && "animate-scale-in",
      )}
      role="status"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {active} letters mastered!
        </p>
        <p className="text-[11px] text-muted-foreground">
          {active === 28
            ? "You've finished the whole alphabet."
            : `${28 - active} to go.`}
        </p>
      </div>
      <button
        onClick={dismiss}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};
