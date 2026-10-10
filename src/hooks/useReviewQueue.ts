import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useAddXP,
  useIncrementReviews,
  useCheckAchievements,
  REVIEW_XP,
} from "@/hooks/useGamification";
import { submitRatingToServer } from "@/hooks/useReview";
import { useDesiredRetention } from "@/hooks/useDesiredRetention";
import { useFsrsCalibration } from "@/hooks/useFsrsCalibration";
import { useFsrsWeights } from "@/hooks/useFsrsWeights";
import type { Rating } from "@/lib/spacedRepetition";
import type { ScheduleDirection } from "@/lib/reviewOrder";
import {
  all,
  bumpAttempts,
  count,
  enqueue as enqueueItem,
  peek,
  remove,
  type QueuedRating,
  type QueuedReviewSnapshot,
} from "@/lib/reviewQueue";

const BACKOFF_MS = [1000, 2000, 5000, 15000, 60000];

/** How often `settle` tries the queue again while it waits. */
const SETTLE_RETRY_MS = 1000;

const isNetworkError = (err: unknown) => {
  const msg = String((err as any)?.message ?? err ?? "");
  return (
    !navigator.onLine ||
    /Failed to send|fetch|network|load failed|timeout|NetworkError/i.test(msg)
  );
};

interface EnqueueArgs {
  wordId: string;
  rating: Rating;
  currentReview: QueuedReviewSnapshot | null;
  /** Which schedule to update. Defaults to recognition. */
  direction?: ScheduleDirection;
}

export function useReviewQueue() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const addXP = useAddXP();
  const desiredRetention = useDesiredRetention();
  const stabilityMultiplier = useFsrsCalibration();
  const { weights } = useFsrsWeights();
  const incrementReviews = useIncrementReviews();
  const checkAchievements = useCheckAchievements();

  const [pendingCount, setPendingCount] = useState(0);
  const [isFlushing, setIsFlushing] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  // The drain in progress, if any: one at a time, and `settle` waits on it.
  const drainRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<number | null>(null);

  // What the drain uses, read through a ref so `flush` keeps one identity per
  // user. The mutation hooks return a new object every render; with them in
  // flush's deps, every render re-ran the drain-on-mount effect below, whose
  // cleanup cancelled the backoff timer and whose body retried at once, so a
  // write that kept failing was retried in a hot loop instead of backing off.
  const latest = useRef({
    addXP,
    incrementReviews,
    checkAchievements,
    queryClient,
    desiredRetention,
    stabilityMultiplier,
    weights,
  });
  latest.current = {
    addXP,
    incrementReviews,
    checkAchievements,
    queryClient,
    desiredRetention,
    stabilityMultiplier,
    weights,
  };

  const refreshCount = useCallback(() => {
    if (!user) {
      setPendingCount(0);
      return;
    }
    setPendingCount(count(user.id));
  }, [user]);

  /**
   * Drain the queue to the server, oldest first. Joining a drain already in
   * progress returns that drain, so whoever waits on it waits for the ratings
   * queued so far: the loop reads the queue afresh after every rating.
   */
  const flush = useCallback((): Promise<void> => {
    if (!user) return Promise.resolve();
    if (drainRef.current) return drainRef.current;
    setIsFlushing(true);
    const drain = (async () => {
      // Yield once, so drainRef holds this drain before it can finish: an empty
      // queue would otherwise clear the ref before it was set, and every later
      // flush would join a drain that had already ended.
      await Promise.resolve();
      try {
        while (true) {
          const item: QueuedRating | null = peek(user.id);
          if (!item) break;

          const { desiredRetention, stabilityMultiplier, weights } = latest.current;
          try {
            await submitRatingToServer(
              user.id,
              item.wordId,
              item.rating,
              item.currentReview as any,
              // Entries queued before directions existed carry no `direction`;
              // those were all recognition ratings, so defaulting keeps a queue
              // that survived the deploy flushing correctly instead of writing
              // them into the wrong column set.
              item.direction ?? "recognition",
              { desiredRetention, stabilityMultiplier, weights }
            );
            remove(user.id, item.id);
            setPendingCount(count(user.id));

            // Side effects on confirmed server save. Flat XP per card — see
            // REVIEW_XP for why it must never key on the self-grade.
            const { addXP, incrementReviews, checkAchievements, queryClient } = latest.current;
            addXP.mutate({ amount: REVIEW_XP, reason: "review" });
            incrementReviews.mutate();
            checkAchievements.mutate();
            queryClient.invalidateQueries({ queryKey: ["review-stats"] });
          } catch (err) {
            if (isNetworkError(err)) {
              bumpAttempts(user.id, item.id);
              const attempts = (item.attempts ?? 0) + 1;
              const delay =
                BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
              if (timerRef.current) window.clearTimeout(timerRef.current);
              timerRef.current = window.setTimeout(() => {
                void flush();
              }, delay);
              break;
            } else {
              // Permanent error — drop and warn
              console.error("Review submit failed permanently:", err);
              remove(user.id, item.id);
              setPendingCount(count(user.id));
              toast.error("One rating couldn't be saved", {
                description:
                  (err as any)?.message ?? "Please try reviewing this word again.",
              });
            }
          }
        }
      } finally {
        drainRef.current = null;
        setIsFlushing(false);
      }
    })();
    drainRef.current = drain;
    return drain;
  }, [user]);

  /**
   * Wait for the ratings queued so far to reach the server, for at most
   * `timeoutMs`. Resolves true once nothing is left queued, false when the
   * wait runs out or the browser is offline (the backoff keeps retrying after
   * it). A network error inside the wait is retried every second rather than
   * on the backoff, since the learner is waiting on it. Never rejects.
   */
  const settle = useCallback(
    async (timeoutMs: number): Promise<boolean> => {
      if (!user) return true;
      const deadline = Date.now() + timeoutMs;
      try {
        while (true) {
          await flush();
          if (count(user.id) === 0) return true;
          const left = deadline - Date.now();
          if (left <= 0 || !navigator.onLine) return false;
          await new Promise((resolve) => window.setTimeout(resolve, Math.min(SETTLE_RETRY_MS, left)));
        }
      } catch {
        return count(user.id) === 0;
      }
    },
    [user, flush],
  );

  /** The ratings not yet on the server, oldest first. */
  const queued = useCallback((): QueuedRating[] => (user ? all(user.id) : []), [user]);

  const enqueue = useCallback(
    (args: EnqueueArgs) => {
      if (!user) return;
      enqueueItem(user.id, {
        wordId: args.wordId,
        rating: args.rating,
        currentReview: args.currentReview,
        direction: args.direction ?? "recognition",
      });
      setPendingCount(count(user.id));
      void flush();
    },
    [user, flush]
  );

  // Online/offline handling
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      void flush();
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flush]);

  // Initial drain on mount / user change
  useEffect(() => {
    if (!user) {
      setPendingCount(0);
      return;
    }
    refreshCount();
    if (all(user.id).length > 0) {
      void flush();
    }
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [user, flush, refreshCount]);

  return {
    enqueue,
    settle,
    queued,
    pendingCount,
    isFlushing,
    isOnline,
  };
}
