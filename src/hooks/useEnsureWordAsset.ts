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

interface Session {
  /** One ask per key: the promise is kept whatever it settled to. */
  asked: Map<string, Promise<EnsureOutcome>>;
  /** Set by the first `limited` answer; nothing more is asked after it. */
  limited: boolean;
}

/**
 * Per query client, which is per page load in the app and per test in the
 * suite. Module state rather than component state because the asking
 * component is mounted once per card and the answer outlives it: a picture
 * can take longer to draw than a card takes to answer.
 */
const sessions = new WeakMap<QueryClient, Session>();

function sessionFor(client: QueryClient): Session {
  let session = sessions.get(client);
  if (!session) {
    session = { asked: new Map(), limited: false };
    sessions.set(client, session);
  }
  return session;
}

/** One call to `word-asset`'s `ensure`. Never throws. */
async function invokeEnsure(input: AssetKeyInput): Promise<EnsureOutcome> {
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
      if (status === 429) return { status: "limited" };
      // Turned away before anything was charged: not deployed yet (404), a
      // word it cannot file (400), a session that has lapsed (401).
      if (status === 400 || status === 401 || status === 404) return { status: "unavailable" };
      return { status: "failed", message: error.message || "The picture could not be made." };
    }
    const body = (data ?? {}) as Record<string, unknown>;
    if (body.error === "daily_limit_reached") return { status: "limited" };
    if (typeof body.url === "string" && body.url) {
      return { status: "made", url: body.url, cached: body.cached === true, stored: body.stored === true };
    }
    // The function's graceful shape for a model that drew nothing.
    return {
      status: "failed",
      message: typeof body.message === "string" ? body.message : "No picture came back.",
    };
  } catch (err) {
    return { status: "failed", message: err instanceof Error ? err.message : String(err) };
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
 * - a word is asked for once per session, whatever came back. A card that is
 *   re-served a minute later shares the first ask and its answer, so a word
 *   never costs two generations, and one that failed is not tried again
 *   behind the learner's back until they reload;
 * - after the first answer that says the daily allowance is spent, nothing
 *   more is asked this session;
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
      if (earlier) return earlier;
      if (session.limited) return Promise.resolve({ status: "limited" });

      const asking = invokeEnsure(input).then((outcome) => {
        if (outcome.status === "limited") session.limited = true;
        if (outcome.status === "made") {
          void queryClient.invalidateQueries({ queryKey: wordAssetQueryKey(key) });
        }
        return outcome;
      });
      session.asked.set(id, asking);
      return asking;
    },
    [queryClient],
  );
}
