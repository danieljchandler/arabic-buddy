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
import type { QuizAsked } from "@/lib/quizRatingFields";
import {
  all,
  bumpAttempts,
  claimsNewCard,
  count,
  enqueue as enqueueItem,
  peek,
  remove,
  type QueuedRating,
  type QueuedReviewSnapshot,
} from "@/lib/reviewQueue";

const BACKOFF_MS = [1000, 2000, 5000, 15000, 60000];

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
  /** What the quiz asked it as; absent for a flip card. */
  asked?: QuizAsked | null;
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

  const flushingRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  // What the drain uses, read through a ref so `flush` keeps one identity per
  // user. The mutation hooks return a new object every render; with them in
  // flush's deps, every render re-ran the drain-on-mount effect below, whose
  // cleanup cancelled the pending backoff timer and whose body called flush
  // again, so how soon a failing write was retried depended on when the hook
  // happened to re-render rather than on the backoff.
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

  const flush = useCallback(async () => {
    if (!user) return;
    if (flushingRef.current) return;
    flushingRef.current = true;
    setIsFlushing(true);
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
            { desiredRetention, stabilityMultiplier, weights },
            item.asked ?? null,
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
          // A first rating claimed a new card (submitRatingToServer counts it
          // on the server); the budget the next deck is built against must
          // know, or each end-of-list refetch offers the whole cap again.
          if (claimsNewCard(item)) queryClient.invalidateQueries({ queryKey: ["daily-new-card-count"] });
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
      flushingRef.current = false;
      setIsFlushing(false);
    }
  }, [user]);

  const enqueue = useCallback(
    (args: EnqueueArgs) => {
      if (!user) return;
      enqueueItem(user.id, {
        wordId: args.wordId,
        rating: args.rating,
        currentReview: args.currentReview,
        direction: args.direction ?? "recognition",
        asked: args.asked ?? null,
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
    pendingCount,
    isFlushing,
    isOnline,
  };
}
