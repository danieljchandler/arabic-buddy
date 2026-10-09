import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { wordAssetQueryKey } from "@/hooks/useWordAsset";
import { assetKey, type AssetKeyInput } from "../../supabase/functions/_shared/wordAssets";

/**
 * What asking the store to make a word's asset came to.
 *
 * Nothing here is an error a learner is shown: the caller is the quiz, asking
 * on its own initiative, and a learner who did not press a button must not be
 * told a button failed. Every outcome but `made` means "go on without it".
 */
export type EnsureOutcome =
  /** There is one: stored already (`cached`), or drawn just now. */
  | { status: "made"; url: string; cached: boolean; stored: boolean }
  /** The learner's daily allowance of pictures is spent. */
  | { status: "limited" }
  /**
   * The store has nothing to do with this word: it cannot be filed (no
   * Arabic, no sense, Fusha), the function is not deployed, or nobody is
   * signed in. Nothing was charged.
   */
  | { status: "unavailable" }
  /** Asked, and it did not work out (a model that drew nothing, a timeout). */
  | { status: "failed"; message: string };

/** A word that failed, or could not be asked, may be asked again after this long. */
export const FORGET_FAILURE_MS = 10 * 60_000;

/** How long nothing is asked after an answer said the daily allowance is spent. */
export const LIMITED_FOR_MS = 60 * 60_000;

/**
 * Failures in a row after which asking is paused (for `FORGET_FAILURE_MS`).
 * `word-asset` charges the allowance before it draws, so with the image
 * provider down every card would otherwise spend one picture on nothing and
 * hold its card while it failed.
 */
export const PAUSE_AFTER_FAILURES = 2;

interface Asked {
  promise: Promise<EnsureOutcome>;
  /** Null while the call is in flight. */
  outcome: EnsureOutcome | null;
  at: number;
}

interface Session {
  /** One ask per key. */
  asked: Map<string, Asked>;
  /** When an answer last said the allowance is spent. */
  limitedAt: number | null;
  /** Failed asks since the last picture. */
  failures: number;
  /** When asking was paused: repeated failures, or a function that is not there. */
  pausedAt: number | null;
}

/**
 * Per query client, which is per page load in the app and per test in the
 * suite. Module state rather than component state because the asking
 * component is mounted once per card and the answer outlives it: a picture
 * can take longer to draw than a card takes to answer.
 *
 * Everything but a picture is forgotten after a while, since a page can stay
 * open for days in an installed app: the allowance resets, a session is
 * renewed, a provider comes back.
 */
const sessions = new WeakMap<QueryClient, Session>();

function sessionFor(client: QueryClient): Session {
  let session = sessions.get(client);
  if (!session) {
    session = { asked: new Map(), limitedAt: null, failures: 0, pausedAt: null };
    sessions.set(client, session);
  }
  return session;
}

const within = (since: number | null, ms: number) => since !== null && Date.now() - since < ms;

interface Answer {
  outcome: EnsureOutcome;
  /** Not about this word: the function is not deployed, or nobody is signed in. */
  systemic?: boolean;
}

/** One call to `word-asset`'s `ensure`. Never throws. */
async function invokeEnsure(input: AssetKeyInput): Promise<Answer> {
  try {
    const { data, error } = await supabase.functions.invoke("word-asset", {
      body: {
        action: "ensure",
        kind: input.kind,
        word: input.word ?? undefined,
        gloss: input.gloss ?? undefined,
        dialect: input.dialect ?? undefined,
      },
    });
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      if (status === 429) return { outcome: { status: "limited" } };
      // Turned away before anything was charged: a word it cannot file (400),
      // the function not deployed yet (404), a session that has lapsed (401).
      if (status === 400) return { outcome: { status: "unavailable" } };
      if (status === 401 || status === 404) return { outcome: { status: "unavailable" }, systemic: true };
      return { outcome: { status: "failed", message: error.message || "The picture could not be made." } };
    }
    const body = (data ?? {}) as Record<string, unknown>;
    if (body.error === "daily_limit_reached") return { outcome: { status: "limited" } };
    if (typeof body.url === "string" && body.url) {
      return {
        outcome: { status: "made", url: body.url, cached: body.cached === true, stored: body.stored === true },
      };
    }
    // The function's graceful shape for a model that drew nothing.
    return {
      outcome: {
        status: "failed",
        message: typeof body.message === "string" ? body.message : "No picture came back.",
      },
    };
  } catch (err) {
    return { outcome: { status: "failed", message: err instanceof Error ? err.message : String(err) } };
  }
}

/**
 * Ask the shared store to make a word's asset: the store's picture if one is
 * filed, else a new one, drawn in the Ink style, filed for every later
 * learner and charged to this learner's daily picture allowance
 * (`word-asset`, `ensure`). The write half of `useWordAsset`, kept apart
 * because that one is a free read and this one can cost a generation.
 *
 * Built for a caller that asks unprompted (the quiz reaching "pick the
 * picture" for a saved word with none), so it is careful with a learner's
 * allowance in three ways:
 *
 * - a word is asked for once, whatever came back. A card that is re-served a
 *   minute later shares the first ask and its answer, so a word never costs
 *   two generations, and one that failed is not tried again behind the
 *   learner's back for `FORGET_FAILURE_MS`;
 * - after an answer that says the daily allowance is spent, nothing is asked
 *   for `LIMITED_FOR_MS`;
 * - after `PAUSE_AFTER_FAILURES` failures in a row, or one answer that says
 *   the function is not there, asking is paused: a failed drawing has already
 *   been charged, and a provider that is down fails every word alike;
 * - it never raises a toast or throws. The picture dialog, where the learner
 *   did press a button, has its own path and its own messages.
 *
 * A picture that was made invalidates the word's `useWordAsset` read, so a
 * card that looks the store up afterwards sees it.
 */
export function useEnsureWordAsset(): (input: AssetKeyInput) => Promise<EnsureOutcome> {
  const queryClient = useQueryClient();

  return useCallback(
    (input: AssetKeyInput): Promise<EnsureOutcome> => {
      const key = assetKey(input);
      if (!key) return Promise.resolve({ status: "unavailable" });

      const session = sessionFor(queryClient);
      const id = wordAssetQueryKey(key).join("\u0000");
      const earlier = session.asked.get(id);
      if (earlier) {
        const stands =
          earlier.outcome === null || earlier.outcome.status === "made" || within(earlier.at, FORGET_FAILURE_MS);
        if (stands) return earlier.promise;
        session.asked.delete(id);
      }
      if (within(session.limitedAt, LIMITED_FOR_MS)) return Promise.resolve({ status: "limited" });
      if (within(session.pausedAt, FORGET_FAILURE_MS)) {
        return Promise.resolve({ status: "failed", message: "Not asking for pictures for now." });
      }

      const asked: Asked = {
        outcome: null,
        at: Date.now(),
        promise: invokeEnsure(input).then(({ outcome, systemic }) => {
          asked.outcome = outcome;
          if (outcome.status === "made") {
            session.failures = 0;
            void queryClient.invalidateQueries({ queryKey: wordAssetQueryKey(key) });
          } else if (outcome.status === "limited") {
            session.limitedAt = Date.now();
          } else if (outcome.status === "failed") {
            if (++session.failures >= PAUSE_AFTER_FAILURES) session.pausedAt = Date.now();
          } else if (systemic) {
            session.pausedAt = Date.now();
          }
          return outcome;
        }),
      };
      session.asked.set(id, asked);
      return asked.promise;
    },
    [queryClient],
  );
}
