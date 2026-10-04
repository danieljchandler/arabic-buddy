import { useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useDesiredRetention } from "./useDesiredRetention";
import { useFsrsCalibration } from "./useFsrsCalibration";
import { useFsrsWeights } from "./useFsrsWeights";
import { useClaimNewCard } from "./useNewCardBudget";
import { useUpdateUserVocabularyReview } from "./useUserVocabulary";
import { calculateNextReview, elapsedDaysSince } from "@/lib/spacedRepetition";
import { describeInvokeFailure } from "@/lib/invokeError";
import { quizRating, type DebriefPlan, type QuizItem } from "@/lib/videoDebrief";

/**
 * The post-video debrief's data: the session plan, the look-ups that feed it,
 * the reviews it writes back, and the admin backfill of the guides behind it.
 */

/** A plan request that failed, with what the page needs to choose its message. */
export class DebriefPlanError extends Error {
  readonly status: number | null;
  /** The function's own error key (`subscription_required`, `no_transcript`, …). */
  readonly code: string | null;

  constructor(message: string, status: number | null, code: string | null) {
    super(message);
    this.name = "DebriefPlanError";
    this.status = status;
    this.code = code;
  }
}

async function planError(error: unknown, data: unknown): Promise<DebriefPlanError> {
  const context = (error as { context?: Response } | null)?.context;
  const status = typeof context?.status === "number" ? context.status : null;
  let code: string | null = null;
  try {
    const body = (await context?.clone().json()) as { error?: unknown } | undefined;
    code = typeof body?.error === "string" ? body.error : null;
  } catch {
    // Not JSON; the status is all there is.
  }
  const failure = await describeInvokeFailure(error, data, "Couldn't prepare this session. Try again in a minute.");
  return new DebriefPlanError(failure.message, status, code);
}

/**
 * What this session covers: steps, the word quiz, the lines to shadow.
 *
 * Fetched once and kept for the life of the page. The quiz cards the learner
 * is answering are the ones the tutor is told about on every turn, so a
 * refetch mid-session that reshuffled them would put the two out of step.
 */
export function useDebriefPlan(videoId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["video-debrief-plan", videoId],
    enabled: Boolean(videoId) && enabled,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<DebriefPlan> => {
      const { data, error } = await supabase.functions.invoke("video-debrief", {
        body: { action: "plan", videoId },
      });
      if (error || !data) throw await planError(error, data);
      return data as DebriefPlan;
    },
  });
}

export interface WordLookup {
  arabic: string;
  english?: string | null;
  lineId?: string | null;
}

/**
 * Remember that the learner looked a word up in this video.
 *
 * Fire-and-forget: a tap that fails to record costs the debrief one quiz word,
 * never the learner their popover. One row per word per video — a second tap
 * is ignored rather than counted — and nothing at all for a signed-out viewer.
 */
export function useRecordWordLookup(videoId: string | undefined) {
  const { user } = useAuth();
  return useCallback(
    (word: WordLookup) => {
      const arabic = word.arabic.trim();
      if (!user || !videoId || !arabic) return;
      void supabase
        .from("video_word_lookups" as never)
        .upsert(
          {
            user_id: user.id,
            video_id: videoId,
            word_arabic: arabic,
            word_english: word.english?.trim() || null,
            line_id: word.lineId ?? null,
          } as never,
          { onConflict: "user_id,video_id,word_arabic", ignoreDuplicates: true },
        )
        .then(({ error }) => {
          if (error) console.warn("[debrief] look-up not recorded:", error.message);
        });
    },
    [user, videoId],
  );
}

interface ReviewableCard {
  id: string;
  ease_factor: number;
  difficulty: number | null;
  interval_days: number;
  repetitions: number;
  last_reviewed_at: string | null;
  lapses: number | null;
  production_lapses: number | null;
  production_next_review_at: string | null;
}

/**
 * Count a quiz answer on a saved word as a review of its flashcard.
 *
 * Scheduled exactly as the My Words review schedules a recognition card —
 * same FSRS call, same retention target, the learner's own fitted weights —
 * so the debrief is one more place a word gets reviewed, not a second
 * scheduler with its own idea of when the word is due. Resolves to whether a
 * card was updated; a word that is not in My Words has no card to move.
 */
export function useDebriefWordReview() {
  const desiredRetention = useDesiredRetention();
  const stabilityMultiplier = useFsrsCalibration();
  const { weights } = useFsrsWeights();
  const updateReview = useUpdateUserVocabularyReview();
  const claimNewCard = useClaimNewCard();

  return useCallback(
    async (item: QuizItem, correct: boolean): Promise<boolean> => {
      if (!item.vocabularyId) return false;
      const { data, error } = await supabase
        .from("user_vocabulary")
        .select(
          "id, ease_factor, difficulty, interval_days, repetitions, last_reviewed_at, lapses, production_lapses, production_next_review_at",
        )
        .eq("id", item.vocabularyId)
        .maybeSingle();
      if (error || !data) return false;
      const card = data as unknown as ReviewableCard;

      const rating = quizRating(correct);
      const result = calculateNextReview(
        rating,
        card.ease_factor,
        card.difficulty ?? 5.0,
        card.interval_days,
        card.repetitions,
        elapsedDaysSince(card.last_reviewed_at),
        { desiredRetention, stabilityMultiplier, weights, fuzzSeed: card.id },
      );
      await updateReview.mutateAsync({
        wordId: card.id,
        stability: result.stability,
        difficulty: result.difficulty,
        intervalDays: result.intervalDays,
        repetitions: result.repetitions,
        nextReviewAt: result.nextReviewAt,
        cardType: "recognition",
        rating,
        productionLocked: card.production_next_review_at === null,
        currentLapses: card.lapses ?? 0,
        currentProductionLapses: card.production_lapses ?? 0,
      });
      // A card's first rating anywhere spends one of today's new cards, as it
      // would have in the review deck.
      if (card.repetitions === 0 && !card.last_reviewed_at) claimNewCard.mutate();
      return true;
    },
    [desiredRetention, stabilityMultiplier, weights, updateReview, claimNewCard],
  );
}

export interface BackfillReport {
  generated: number;
  skipped: number;
  failed: number;
  /** The guides were written but could not be stored — the migration is missing. */
  storeFailed: boolean;
}

interface BackfillPage {
  results: Array<{ id: string; status: string }>;
  cursor: string | null;
  remaining: number;
  storeFailed: boolean;
}

/**
 * Write a study guide for every published video that has none (admin).
 *
 * The function does a few videos per call — each is a model call, and a
 * request has a wall clock — so this walks it by cursor until nothing
 * remains, reporting progress as it goes.
 */
export function useBackfillStudyGuides() {
  return useMutation({
    mutationFn: async ({ onProgress }: { onProgress?: (done: number, remaining: number) => void } = {}) => {
      const report: BackfillReport = { generated: 0, skipped: 0, failed: 0, storeFailed: false };
      let cursor: string | null = null;
      let done = 0;
      for (;;) {
        const { data, error } = await supabase.functions.invoke("video-study-guide", {
          body: { action: "backfill", limit: 2, after: cursor },
        });
        if (error || !data) {
          const failure = await describeInvokeFailure(error, data, "The backfill stopped. Run it again to carry on.");
          throw new Error(failure.message);
        }
        const page = data as BackfillPage;
        for (const result of page.results) {
          if (result.status === "generated" || result.status === "current") report.generated++;
          else if (result.status === "failed") report.failed++;
          else report.skipped++;
        }
        done += page.results.length;
        onProgress?.(done, page.remaining);
        if (page.storeFailed) {
          report.storeFailed = true;
          return report;
        }
        if (page.remaining <= 0 || page.results.length === 0) return report;
        cursor = page.cursor;
      }
    },
  });
}
