import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { describeInvokeFailure } from "@/lib/invokeError";
import { recapClock, type RecapOutcome, type RecapPlan, type RecapSummary } from "@/lib/recap";

/**
 * The daily recap's data: what there is to go over (for the strip and the
 * Today queue), the session plan, and the record of a finished session.
 */

/** A plan request that failed, with what the page needs to choose its message. */
export class RecapPlanError extends Error {
  readonly status: number | null;
  /** The function's own error key (`subscription_required`, `nothing_to_recap`, …). */
  readonly code: string | null;

  constructor(message: string, status: number | null, code: string | null) {
    super(message);
    this.name = "RecapPlanError";
    this.status = status;
    this.code = code;
  }
}

async function planError(error: unknown, data: unknown): Promise<RecapPlanError> {
  const context = (error as { context?: Response } | null)?.context;
  const status = typeof context?.status === "number" ? context.status : null;
  let code: string | null = null;
  try {
    const body = (await context?.clone().json()) as { error?: unknown } | undefined;
    code = typeof body?.error === "string" ? body.error : null;
  } catch {
    // Not JSON; the status is all there is.
  }
  const failure = await describeInvokeFailure(error, data, "Couldn't prepare your recap. Try again in a minute.");
  return new RecapPlanError(failure.message, status, code);
}

export const recapSummaryKey = (userId: string | undefined, dialect: string, date: string) =>
  ["recap-summary", userId, dialect, date] as const;

/**
 * Whether there is anything to recap today, and what.
 *
 * One request per learner, dialect and local day: the window ends at last
 * midnight, so nothing the learner does today changes the answer except
 * finishing the session — which the completion mutation writes into the
 * cache directly. Signed-in learners only; `enabled` lets a caller keep it
 * off on screens where the strip has no business.
 */
export function useRecapSummary(opts: { enabled?: boolean } = {}) {
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const clock = recapClock();
  return useQuery({
    queryKey: recapSummaryKey(user?.id, activeDialect, clock.localDate),
    enabled: Boolean(user) && (opts.enabled ?? true),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<RecapSummary> => {
      const { data, error } = await supabase.functions.invoke("daily-recap", {
        body: { action: "summary", dialect: activeDialect, ...clock },
      });
      if (error || !data) throw await planError(error, data);
      return data as RecapSummary;
    },
  });
}

/**
 * The session: steps, the word quiz, the slips, the lines to shadow, and the
 * notes the tutor reads from.
 *
 * Fetched once and kept for the life of the page, as the debrief's plan is:
 * the cards the learner is answering are the ones the tutor is told about on
 * every turn, so a refetch mid-session that reshuffled them would put the two
 * out of step.
 */
export function useRecapPlan(enabled = true) {
  const { activeDialect } = useDialect();
  return useQuery({
    queryKey: ["recap-plan", activeDialect, recapClock().localDate],
    enabled,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<RecapPlan> => {
      const { data, error } = await supabase.functions.invoke("daily-recap", {
        body: { action: "plan", dialect: activeDialect, ...recapClock() },
      });
      if (error || !data) throw await planError(error, data);
      return data as RecapPlan;
    },
  });
}

/**
 * Record a finished session.
 *
 * Fire-and-forget from the page's point of view: a completion that did not
 * save costs the strip one day of knowing, never the learner their recap.
 * The summary in the cache is marked complete straight away, so the strip
 * and the Today queue agree with the page without a refetch.
 */
export function useCompleteRecap() {
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (outcome: RecapOutcome): Promise<{ stored: boolean }> => {
      const { data, error } = await supabase.functions.invoke("daily-recap", {
        body: { action: "complete", dialect: activeDialect, ...recapClock(), outcome },
      });
      if (error) throw error;
      return { stored: (data as { stored?: boolean } | null)?.stored === true };
    },
    onMutate: () => {
      const key = recapSummaryKey(user?.id, activeDialect, recapClock().localDate);
      queryClient.setQueryData<RecapSummary>(key, (prev) => (prev ? { ...prev, status: "completed" } : prev));
    },
  });
}
