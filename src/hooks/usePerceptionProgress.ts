import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import {
  CONTRASTS,
  contrastStatus,
  MINUTES_PER_CONTRAST,
  programmeStatus,
  type ContrastProgressRow,
  type ContrastStatus,
  type ProgrammeStatus,
} from "@/lib/perceptionPairs";

/**
 * Perception-training progress for the signed-in learner in the active
 * dialect: one row per contrast, merged on write like the alphabet journey's
 * letter rows (a round adds to what is there; it never resets it).
 *
 * A contrast completes when its share of the 400-minute programme is met;
 * a completed contrast that is RESURFACE_AFTER_DAYS old is offered once more
 * as a first-attempt check, and that check's numbers are kept apart so the
 * durability of the gain can be read later (research §5b: the literature
 * says no decay at 2.3 months; nobody has measured it for Arabic).
 */
export interface RoundResult {
  contrastId: string;
  attempts: number;
  correct: number;
  seconds: number;
  /** True when this round was the durability check on a completed contrast. */
  resurface?: boolean;
}

export function usePerceptionProgress() {
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const qc = useQueryClient();
  const key = ["perception-progress", user?.id, activeDialect];

  const query = useQuery({
    queryKey: key,
    enabled: !!user?.id,
    queryFn: async (): Promise<Record<string, ContrastProgressRow>> => {
      const { data, error } = await supabase
        .from("user_perception_progress")
        .select("contrast_id, attempts, correct, seconds, completed_at, resurfaced_at, resurface_attempts, resurface_correct")
        .eq("user_id", user!.id)
        .eq("dialect", activeDialect);
      if (error) throw error;
      const map: Record<string, ContrastProgressRow> = {};
      for (const row of data ?? []) map[row.contrast_id] = row as ContrastProgressRow;
      return map;
    },
  });

  const rows = useMemo(() => query.data ?? {}, [query.data]);

  const recordRound = useMutation({
    mutationFn: async (result: RoundResult) => {
      if (!user?.id) return;
      const existing = rows[result.contrastId];
      const now = new Date();
      const nowIso = now.toISOString();

      const next: Record<string, unknown> = {
        user_id: user.id,
        dialect: activeDialect,
        contrast_id: result.contrastId,
        last_practiced_at: nowIso,
      };

      if (result.resurface) {
        // The check is recorded once, on the first attempt after the gap, and
        // does not count toward the contrast's own numbers.
        next.resurfaced_at = existing?.resurfaced_at ?? nowIso;
        next.resurface_attempts = (existing?.resurface_attempts ?? 0) + result.attempts;
        next.resurface_correct = (existing?.resurface_correct ?? 0) + result.correct;
      } else {
        const seconds = (existing?.seconds ?? 0) + result.seconds;
        next.attempts = (existing?.attempts ?? 0) + result.attempts;
        next.correct = (existing?.correct ?? 0) + result.correct;
        next.seconds = seconds;
        if (!existing?.completed_at && seconds >= MINUTES_PER_CONTRAST * 60) {
          next.completed_at = nowIso;
        }
      }

      const { error } = await supabase
        .from("user_perception_progress")
        .upsert(next as never, { onConflict: "user_id,dialect,contrast_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const now = useMemo(() => new Date(), [query.dataUpdatedAt]);

  const statusFor = useCallback(
    (contrastId: string): ContrastStatus => contrastStatus(contrastId, rows[contrastId], now),
    [rows, now],
  );

  const programme: ProgrammeStatus = useMemo(
    () => programmeStatus(Object.values(rows), now),
    [rows, now],
  );

  return {
    rows,
    isLoading: query.isLoading,
    statusFor,
    programme,
    contrasts: CONTRASTS,
    recordRound: recordRound.mutateAsync,
    isRecording: recordRound.isPending,
  };
}
