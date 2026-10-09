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
  /**
   * There is one: stored already (`cached`), or made just now. A picture is
   * its `url`; an exchange is its `payload` (`{ lines }`), with no url.
   */
  | { status: "made"; url: string | null; payload?: unknown; cached: boolean; stored: boolean }
  /** The learner's daily allowance for this kind is spent. */
  | { status: "limited" }
  /**
   * The store has nothing to do with this word: it cannot be filed (no
   * Arabic, no sense, Fusha), the function is not deployed or does not make
   * this kind, the store's table is not there yet, or nobody is signed in.
   * Nothing was charged.
   */
  | { status: "unavailable" }
  /** Asked, and it did not work out (a model that made nothing usable, a timeout). */
  | { status: "failed"; message: string };

/** A word that failed, or could not be asked, may be asked again after this long. */
export const FORGET_FAILURE_MS = 10 * 60_000;

/** How long nothing of a kind is asked after an answer said its daily allowance is spent. */
export const LIMITED_FOR_MS = 60 * 60_000;

/**
 * Failures in a row after which asking for a kind is paused (for
 * `FORGET_FAILURE_MS`). `word-asset` charges the allowance before it makes
 * anything, so with the provider down every card would otherwise spend one
 * of the day's allowance on nothing and hold its card while it failed.
 */
export const PAUSE_AFTER_FAILURES = 2;

interface Asked {
  promise: Promise<EnsureOutcome>;
  /** Null while the call is in flight. */
  outcome: EnsureOutcome | null;
  at: number;
}

/**
 * What one kind of asset has come to this session. Kept per kind because each
 * is charged on its own counter and fails for its own reasons: a learner whose
 * pictures are spent for the day still gets their dialogues, and an outage of
 * the image model does not stop the text one.
 */
interface KindState {
  /** When an answer last said the allowance is spent. */
  limitedAt: number | null;
  /** Failed asks since the last one that worked. */
  failures: number;
  /** When asking was paused: repeated failures, or a function that cannot make it. */
  pausedAt: number | null;
}

interface Session {
  /** One ask per key (the key carries the kind). */
  asked: Map<string, Asked>;
  kinds: Map<string, KindState>;
}

/**
 * Per query client, which is per page load in the app and per test in the
 * suite. Module state rather than component state because the asking
 * component is mounted once per card and the answer outlives it: a picture
 * can take longer to draw than a card takes to answer.
 *
 * Everything but what was made is forgotten after a while, since a page can
 * stay open for days in an installed app: the allowance resets, a session is
 * renewed, a provider comes back.
 */
const sessions = new WeakMap<QueryClient, Session>();

function sessionFor(client: QueryClient): Session {
  let session = sessions.get(client);
  if (!session) {
    session = { asked: new Map(), kinds: new Map() };
    sessions.set(client, session);
  }
  return session;
}

function kindState(session: Session, kind: string): KindState {
  let state = session.kinds.get(kind);
  if (!state) {
    state = { limitedAt: null, failures: 0, pausedAt: null };
    session.kinds.set(kind, state);
  }
  return state;
}

const within = (since: number | null, ms: number) => since !== null && Date.now() - since < ms;

interface Answer {
  outcome: EnsureOutcome;
  /**
   * Not about this word but about the kind: the function is not deployed, does
   * not make it, has no table to keep it in, or nobody is signed in.
   */
  systemic?: boolean;
}

/**
 * Error codes in a refusal's body that say the kind, not the word, cannot be
 * made: an older `word-asset` that makes only pictures, and a store whose
 * table is not applied yet (a dialogue is never made then).
 */
const KIND_REFUSALS = new Set(["kind_not_generated", "store_not_ready"]);

/** The `error` code a refused call's body carries, if it can be read. */
async function refusalCode(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!context || typeof context !== "object" || typeof (context as Response).clone !== "function") return null;
  try {
    const body = (await (context as Response).clone().json()) as { error?: unknown } | null;
    return typeof body?.error === "string" ? body.error : null;
  } catch {
    return null;
  }
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
      // Turned away before anything was charged: a kind this deployment does
      // not make, or a store with no table yet (400, 503), the function not
      // deployed yet (404), a session that has lapsed (401) — none of which
      // the next word will fare better at — or a word it cannot file (400).
      if (status === 400 || status === 503) {
        if (KIND_REFUSALS.has((await refusalCode(error)) ?? "")) {
          return { outcome: { status: "unavailable" }, systemic: true };
        }
        if (status === 400) return { outcome: { status: "unavailable" } };
      }
      if (status === 401 || status === 404) return { outcome: { status: "unavailable" }, systemic: true };
      return { outcome: { status: "failed", message: error.message || "It could not be made." } };
    }
    const body = (data ?? {}) as Record<string, unknown>;
    if (body.error === "daily_limit_reached") return { outcome: { status: "limited" } };
    const url = typeof body.url === "string" && body.url ? body.url : null;
    // An exchange is text: on the filed asset, or on the answer itself when it
    // could not be filed.
    const asset = body.asset && typeof body.asset === "object" ? (body.asset as { payload?: unknown }) : null;
    const payload = asset?.payload ?? body.payload ?? null;
    if (url || payload !== null) {
      return {
        outcome: {
          status: "made",
          url,
          ...(payload !== null ? { payload } : {}),
          cached: body.cached === true,
          stored: body.stored === true,
        },
      };
    }
    // The function's graceful shape for a model that made nothing usable.
    return {
      outcome: {
        status: "failed",
        message: typeof body.message === "string" ? body.message : "Nothing came back.",
      },
    };
  } catch (err) {
    return { outcome: { status: "failed", message: err instanceof Error ? err.message : String(err) } };
  }
}

/**
 * Ask the shared store to make a word's asset: the store's if one is filed,
 * else a new one, filed for every later learner and charged to this learner's
 * daily allowance for the kind (`word-asset`, `ensure`) — a picture drawn in
 * the Ink style on their picture allowance, or an exchange written on their
 * dialogue allowance. The write half of `useWordAsset`, kept apart because
 * that one is a free read and this one can cost a generation.
 *
 * Built for a caller that asks unprompted (the quiz reaching "pick the
 * picture" for a saved word with none, or a reply step for a word its lesson
 * has no line for), so it is careful with a learner's allowance:
 *
 * - a word is asked for once, whatever came back. A card that is re-served a
 *   minute later shares the first ask and its answer, so a word never costs
 *   two generations, and one that failed is not tried again behind the
 *   learner's back for `FORGET_FAILURE_MS`;
 * - after an answer that says a kind's daily allowance is spent, nothing of
 *   that kind is asked for `LIMITED_FOR_MS`;
 * - after `PAUSE_AFTER_FAILURES` failures of a kind in a row, or one answer
 *   that says the kind cannot be made at all, asking for that kind is paused:
 *   a failed attempt has already been charged, and a provider that is down
 *   fails every word alike;
 * - every one of those is per kind. Each kind is charged on its own counter
 *   and made by its own model, so a spent picture allowance or an image
 *   outage does not stop dialogues, and the reverse;
 * - it never raises a toast or throws. The picture dialog, where the learner
 *   did press a button, has its own path and its own messages.
 *
 * Whatever was made invalidates the word's `useWordAsset` read, so a card
 * that looks the store up afterwards sees it.
 */
export function useEnsureWordAsset(): (input: AssetKeyInput) => Promise<EnsureOutcome> {
  const queryClient = useQueryClient();

  return useCallback(
    (input: AssetKeyInput): Promise<EnsureOutcome> => {
      const key = assetKey(input);
      if (!key) return Promise.resolve({ status: "unavailable" });

      const session = sessionFor(queryClient);
      const kind = kindState(session, key.kind);
      const id = wordAssetQueryKey(key).join("\u0000");
      const earlier = session.asked.get(id);
      if (earlier) {
        const stands =
          earlier.outcome === null || earlier.outcome.status === "made" || within(earlier.at, FORGET_FAILURE_MS);
        if (stands) return earlier.promise;
        session.asked.delete(id);
      }
      if (within(kind.limitedAt, LIMITED_FOR_MS)) return Promise.resolve({ status: "limited" });
      if (within(kind.pausedAt, FORGET_FAILURE_MS)) {
        return Promise.resolve({ status: "failed", message: `Not asking for ${key.kind} assets for now.` });
      }

      const asked: Asked = {
        outcome: null,
        at: Date.now(),
        promise: invokeEnsure(input).then(({ outcome, systemic }) => {
          asked.outcome = outcome;
          if (outcome.status === "made") {
            kind.failures = 0;
            void queryClient.invalidateQueries({ queryKey: wordAssetQueryKey(key) });
          } else if (outcome.status === "limited") {
            kind.limitedAt = Date.now();
          } else if (outcome.status === "failed") {
            if (++kind.failures >= PAUSE_AFTER_FAILURES) kind.pausedAt = Date.now();
          } else if (systemic) {
            kind.pausedAt = Date.now();
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
