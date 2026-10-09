import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import type { SupabaseBackend } from "@/test/support/server/handler";
import type { AssetKeyInput } from "../../supabase/functions/_shared/wordAssets";
import { FORGET_FAILURE_MS, LIMITED_FOR_MS, PAUSE_AFTER_FAILURES, useEnsureWordAsset } from "./useEnsureWordAsset";
import { useWordAsset } from "./useWordAsset";

/**
 * Asking the store to make a word's picture, from the browser.
 *
 * The caller is the quiz, asking on its own initiative when a saved word
 * reaches "pick the picture" with no picture. So the cases are about a
 * learner's allowance being spent behind their back: a word asked for twice,
 * a failure retried on every card, asks that carry on after the daily cap
 * said no — and about the read-only hook seeing what this one made.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

/** Moves the clock without touching the timers the backend answers on. */
function laterBy(ms: number) {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + ms });
}

const BREAD: AssetKeyInput = { kind: "image", word: "خبز", gloss: "bread", dialect: "Gulf" };

const COFFEE: AssetKeyInput = { kind: "image", word: "قَهْوَة", gloss: "Coffee", dialect: "Gulf" };
const TEA: AssetKeyInput = { kind: "image", word: "شاي", gloss: "tea", dialect: "Gulf" };
const DRAWN = "https://cdn.test/coffee-drawn.png";

const filedCoffee = () => ({
  id: "asset-coffee",
  concept_key: "قهوه|coffee",
  kind: "image",
  dialect: "Gulf",
  style_version: "ink-1",
  url: DRAWN,
  payload: null,
  meta: {},
  source: "generated",
  approved_at: null,
  created_at: "2026-10-09T00:00:00Z",
});

/** `read` also mounts the read-only hook on coffee, as a card looking the store up does. */
function render(seed?: (backend: SupabaseBackend) => void, read = false) {
  const rendered = renderHookWithProviders(() => ({ ensure: useEnsureWordAsset(), stored: useWordAsset(read ? COFFEE : null) }), {
    persona: "free",
    seed: (backend) => {
      backend.db.seed("word_assets", []);
      backend.stubFunction("word-asset", { asset: null, url: DRAWN, cached: false, stored: true });
      seed?.(backend);
    },
  });
  cleanup = rendered.cleanup;
  return rendered;
}

describe("useEnsureWordAsset", () => {
  it("asks word-asset to ensure the word's picture, by the word alone", async () => {
    const { result, backend } = render();

    const outcome = await result.current.ensure(COFFEE);

    expect(outcome).toEqual({ status: "made", url: DRAWN, cached: false, stored: true });
    // The word, its sense and its dialect: nothing a learner could steer a
    // shared picture with, and no scene (that is the trusted path's).
    expect(backend.lastCallTo("word-asset")?.body).toEqual({
      action: "ensure",
      kind: "image",
      word: "قَهْوَة",
      gloss: "Coffee",
      dialect: "Gulf",
    });
  });

  it("says when the picture was the store's, which cost nothing", async () => {
    const { result } = render((backend) =>
      backend.stubFunction("word-asset", { asset: { id: "a" }, url: DRAWN, cached: true, stored: true }),
    );
    expect(await result.current.ensure(COFFEE)).toMatchObject({ status: "made", cached: true });
  });

  it("asks once for a word, however many cards ask and however it is spelt", async () => {
    // A failed card is re-served at once on a short deck: a second frame, the
    // same word, the first picture still being drawn.
    const { result, backend } = render((b) => b.db.delayFunction("word-asset", 30));

    const [first, second] = await Promise.all([
      result.current.ensure(COFFEE),
      result.current.ensure({ ...COFFEE, word: "قهوة", gloss: "coffee" }),
    ]);
    const later = await result.current.ensure(COFFEE);

    expect(backend.callsTo("word-asset")).toHaveLength(1);
    expect(second).toEqual(first);
    expect(later).toEqual(first);
  });

  it("asks separately for another word, and for the same word in another dialect", async () => {
    const { result, backend } = render();

    await result.current.ensure(COFFEE);
    await result.current.ensure(TEA);
    await result.current.ensure({ ...COFFEE, dialect: "Egyptian" });

    expect(backend.callsTo("word-asset")).toHaveLength(3);
  });

  const FAILED = { error: "IMAGE_GENERATION_FAILED", fallback: true, message: "Could not make a picture." };

  it("does not try a word again for a while once it has failed", async () => {
    // A failed drawing was charged all the same: the card that is re-served
    // a minute later must not pay for a second one.
    const { result, backend } = render((b) => b.stubFunction("word-asset", FAILED));

    expect(await result.current.ensure(COFFEE)).toEqual({ status: "failed", message: "Could not make a picture." });
    expect(await result.current.ensure(COFFEE)).toMatchObject({ status: "failed" });
    expect(backend.callsTo("word-asset")).toHaveLength(1);

    // A page left open is not held to it for ever.
    laterBy(FORGET_FAILURE_MS + 1_000);
    await result.current.ensure(COFFEE);
    expect(backend.callsTo("word-asset")).toHaveLength(2);
  });

  it("stops asking after failures in a row, so an outage does not spend the day's pictures", async () => {
    const { result, backend } = render((b) => b.stubFunction("word-asset", FAILED));

    await result.current.ensure(COFFEE);
    await result.current.ensure(TEA);
    expect(backend.callsTo("word-asset")).toHaveLength(PAUSE_AFTER_FAILURES);

    // A third word, with the provider still down: not asked, not charged.
    expect(await result.current.ensure(BREAD)).toMatchObject({ status: "failed" });
    expect(backend.callsTo("word-asset")).toHaveLength(PAUSE_AFTER_FAILURES);

    laterBy(FORGET_FAILURE_MS + 1_000);
    backend.stubFunction("word-asset", { asset: null, url: DRAWN, cached: false, stored: true });
    expect(await result.current.ensure(BREAD)).toMatchObject({ status: "made" });
  });

  it("counts failures only while they are in a row", async () => {
    const answers: unknown[] = [FAILED, { asset: null, url: DRAWN, cached: false, stored: true }, FAILED];
    const { result, backend } = render((b) => b.stubFunction("word-asset", () => answers.shift()));

    await result.current.ensure(COFFEE);
    await result.current.ensure(TEA);
    await result.current.ensure(BREAD);
    // One failure, a picture, one failure: nothing paused, so a fourth is asked.
    await result.current.ensure({ ...BREAD, dialect: "Yemeni" });
    expect(backend.callsTo("word-asset")).toHaveLength(4);
  });

  it("stops asking for anything once the daily allowance is spent, until it may have reset", async () => {
    const { result, backend } = render((b) => b.stubFunctionCapped("word-asset"));

    expect(await result.current.ensure(COFFEE)).toEqual({ status: "limited" });
    // Another word: not asked at all.
    expect(await result.current.ensure(TEA)).toEqual({ status: "limited" });
    expect(backend.callsTo("word-asset")).toHaveLength(1);

    laterBy(LIMITED_FOR_MS + 1_000);
    await result.current.ensure(TEA);
    expect(backend.callsTo("word-asset")).toHaveLength(2);
  });

  it("reads a word the function cannot file as nothing to do, and goes on to the next", async () => {
    const { result, backend } = render((b) => b.stubFunctionFailure("word-asset", 400));

    expect(await result.current.ensure(COFFEE)).toEqual({ status: "unavailable" });
    await result.current.ensure(TEA);
    expect(backend.callsTo("word-asset")).toHaveLength(2);
  });

  it("asks nothing more once the function turns out not to be there, or the session has lapsed", async () => {
    for (const status of [404, 401]) {
      const { result, backend } = render((b) => b.stubFunctionFailure("word-asset", status));

      expect(await result.current.ensure(COFFEE), String(status)).toEqual({ status: "unavailable" });
      await result.current.ensure(TEA);
      expect(backend.callsTo("word-asset"), String(status)).toHaveLength(1);
      cleanup?.();
      cleanup = undefined;
    }
  });

  it("asks nothing at all for a word the store cannot file", async () => {
    const { result, backend } = render();

    expect(await result.current.ensure({ ...COFFEE, dialect: "MSA" })).toEqual({ status: "unavailable" });
    expect(await result.current.ensure({ ...COFFEE, word: "coffee" })).toEqual({ status: "unavailable" });
    expect(await result.current.ensure({ ...COFFEE, gloss: "" })).toEqual({ status: "unavailable" });
    expect(backend.callsTo("word-asset")).toEqual([]);
  });

  it("reports a server error as a failure, never as a thrown error", async () => {
    const { result } = render((b) => b.stubFunctionFailure("word-asset", 500));
    expect(await result.current.ensure(COFFEE)).toMatchObject({ status: "failed" });
  });

  it("lets the read-only hook see what it made", async () => {
    // The lookup misses; the picture is then drawn and filed; the same
    // lookup, invalidated, finds it without the card asking again.
    const { result, backend } = render(
      (b) =>
        b.stubFunction("word-asset", ({ db }) => {
          db.add("word_assets", filedCoffee());
          return { asset: { id: "asset-coffee" }, url: DRAWN, cached: false, stored: true };
        }),
      true,
    );
    await waitFor(() => expect(result.current.stored.isLoading).toBe(false));
    expect(result.current.stored.url).toBeNull();

    await act(async () => {
      await result.current.ensure(COFFEE);
    });

    await waitFor(() => expect(result.current.stored.url).toBe(DRAWN));
    expect(backend.callsTo("word-asset")).toHaveLength(1);
  });
});
