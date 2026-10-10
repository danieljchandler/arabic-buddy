import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { capLimited } from "@/test/support/server/functions";
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
const FAILED = { error: "IMAGE_GENERATION_FAILED", fallback: true, message: "Could not make a picture." };

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

describe("each kind on its own", () => {
  // Pictures and exchanges are charged on different counters and made by
  // different models, so nothing one of them comes to may stop the other.
  const TALK: AssetKeyInput = { kind: "dialogue", word: "قهوة", gloss: "coffee", dialect: "Gulf" };
  const TEA_TALK: AssetKeyInput = { ...TEA, kind: "dialogue" };
  const BREAD_TALK: AssetKeyInput = { ...BREAD, kind: "dialogue" };
  const EXCHANGE = {
    lines: [
      { speaker: "Friend", arabic: "تبي شي؟", english: "Want something?", transliteration: "" },
      { speaker: "Guest", arabic: "ابي قهوة", english: "I want coffee", transliteration: "" },
    ],
  };
  const MADE_TALK = { asset: { id: "asset-talk", payload: EXCHANGE }, url: null, cached: false, stored: true };
  const MADE_PICTURE = { asset: null, url: DRAWN, cached: false, stored: true };

  /** word-asset answering each kind its own way. */
  const byKind = (answers: Record<string, unknown>) => ({ body }: { body: unknown }) =>
    answers[(body as { kind: string }).kind];

  const calls = (backend: SupabaseBackend, kind: string) =>
    backend.callsTo("word-asset").filter((call) => (call.body as { kind?: string }).kind === kind);

  it("hands back an exchange's lines, which have no url", async () => {
    const { result, backend } = render((b) => b.stubFunction("word-asset", MADE_TALK));

    expect(await result.current.ensure(TALK)).toEqual({
      status: "made",
      url: null,
      payload: EXCHANGE,
      cached: false,
      stored: true,
    });
    // The word alone, as for a picture: no sentence, no example.
    expect(backend.lastCallTo("word-asset")?.body).toEqual({
      action: "ensure",
      kind: "dialogue",
      word: "قهوة",
      gloss: "coffee",
      dialect: "Gulf",
    });
  });

  it("asks for a word's picture and its exchange separately", async () => {
    const { result, backend } = render((b) =>
      b.stubFunction("word-asset", byKind({ image: MADE_PICTURE, dialogue: MADE_TALK })),
    );

    await result.current.ensure(COFFEE);
    await result.current.ensure(TALK);
    await result.current.ensure(TALK);
    expect(calls(backend, "image")).toHaveLength(1);
    expect(calls(backend, "dialogue")).toHaveLength(1);
  });

  it("still asks for exchanges once the day's pictures are spent, and the reverse", async () => {
    const pictures = render((b) => b.stubFunction("word-asset", byKind({ image: capLimited(), dialogue: MADE_TALK })));
    expect(await pictures.result.current.ensure(COFFEE)).toEqual({ status: "limited" });
    expect(await pictures.result.current.ensure(TALK)).toMatchObject({ status: "made" });
    expect(await pictures.result.current.ensure(TEA)).toEqual({ status: "limited" });
    expect(calls(pictures.backend, "image")).toHaveLength(1);
    cleanup?.();

    const talk = render((b) => b.stubFunction("word-asset", byKind({ image: MADE_PICTURE, dialogue: capLimited() })));
    expect(await talk.result.current.ensure(TALK)).toEqual({ status: "limited" });
    expect(await talk.result.current.ensure(COFFEE)).toMatchObject({ status: "made" });
    expect(await talk.result.current.ensure(TEA_TALK)).toEqual({ status: "limited" });
    expect(calls(talk.backend, "dialogue")).toHaveLength(1);
  });

  it("stops story passages and exchanges together when their shared allowance is spent, and nothing else", async () => {
    // A passage is charged on the exchange's counter, so the answer that one
    // is spent is about the other too; a picture is on a counter of its own.
    const STORY: AssetKeyInput = { kind: "story_line", word: "قهوة", gloss: "coffee", dialect: "Gulf" };
    const PASSAGE = {
      sentences: [
        { arabic: "كان الصبح بارد.", english: "The morning was cold." },
        { arabic: "طلب قهوة.", english: "He ordered coffee." },
      ],
    };
    const MADE_STORY = { asset: { id: "asset-story", payload: PASSAGE }, url: null, cached: false, stored: true };

    const spentByTalk = render((b) =>
      b.stubFunction("word-asset", byKind({ image: MADE_PICTURE, dialogue: capLimited(), story_line: MADE_STORY })),
    );
    expect(await spentByTalk.result.current.ensure(TALK)).toEqual({ status: "limited" });
    expect(await spentByTalk.result.current.ensure(STORY)).toEqual({ status: "limited" });
    expect(calls(spentByTalk.backend, "story_line")).toHaveLength(0);
    expect(await spentByTalk.result.current.ensure(COFFEE)).toMatchObject({ status: "made" });
    cleanup?.();

    const spentByStory = render((b) =>
      b.stubFunction("word-asset", byKind({ image: MADE_PICTURE, dialogue: MADE_TALK, story_line: capLimited() })),
    );
    expect(await spentByStory.result.current.ensure(STORY)).toEqual({ status: "limited" });
    expect(await spentByStory.result.current.ensure(TALK)).toEqual({ status: "limited" });
    expect(calls(spentByStory.backend, "dialogue")).toHaveLength(0);
    cleanup?.();

    // A passage's own failures pause passages only.
    const failing = render((b) =>
      b.stubFunction("word-asset", byKind({ image: MADE_PICTURE, dialogue: MADE_TALK, story_line: FAILED })),
    );
    await failing.result.current.ensure(STORY);
    await failing.result.current.ensure({ ...STORY, word: "شاي", gloss: "tea" });
    expect(await failing.result.current.ensure({ ...STORY, word: "خبز", gloss: "bread" })).toMatchObject({ status: "failed" });
    expect(calls(failing.backend, "story_line")).toHaveLength(PAUSE_AFTER_FAILURES);
    expect(await failing.result.current.ensure(TALK)).toMatchObject({ status: "made" });
    // And a made passage hands back its sentences, which have no url.
    cleanup?.();
    const made = render((b) => b.stubFunction("word-asset", MADE_STORY));
    expect(await made.result.current.ensure(STORY)).toEqual({ status: "made", url: null, payload: PASSAGE, cached: false, stored: true });
  });

  it("pauses a kind after its own failures in a row, and goes on asking for the other", async () => {
    const { result, backend } = render((b) => b.stubFunction("word-asset", byKind({ image: FAILED, dialogue: MADE_TALK })));

    await result.current.ensure(COFFEE);
    await result.current.ensure(TEA);
    expect(await result.current.ensure(BREAD)).toMatchObject({ status: "failed" });
    expect(calls(backend, "image")).toHaveLength(PAUSE_AFTER_FAILURES);

    expect(await result.current.ensure(TALK)).toMatchObject({ status: "made" });
    expect(await result.current.ensure(TEA_TALK)).toMatchObject({ status: "made" });
    expect(calls(backend, "dialogue")).toHaveLength(2);
  });

  it("stops asking for a kind the function does not make, or cannot keep yet, and nothing else", async () => {
    for (const [status, error] of [
      [400, "kind_not_generated"],
      [503, "store_not_ready"],
    ] as const) {
      const { result, backend } = render((b) =>
        b.stubFunction(
          "word-asset",
          byKind({ image: MADE_PICTURE, dialogue: { status, body: { error, fallback: true } } }),
        ),
      );

      expect(await result.current.ensure(TALK), error).toEqual({ status: "unavailable" });
      // The next word's exchange would be turned away the same way: not asked.
      await result.current.ensure(TEA_TALK);
      await result.current.ensure(BREAD_TALK);
      expect(calls(backend, "dialogue"), error).toHaveLength(1);
      // Pictures are another matter.
      expect(await result.current.ensure(COFFEE), error).toMatchObject({ status: "made" });

      laterBy(FORGET_FAILURE_MS + 1_000);
      await result.current.ensure(TEA_TALK);
      expect(calls(backend, "dialogue"), error).toHaveLength(2);
      cleanup?.();
      cleanup = undefined;
      vi.useRealTimers();
    }
  });

  it("reads an exchange that could not be written as a failure for that word", async () => {
    const { result } = render((b) =>
      b.stubFunction("word-asset", { error: "msa_leak", fallback: true, message: "The line was not in the dialect." }),
    );
    expect(await result.current.ensure(TALK)).toEqual({ status: "failed", message: "The line was not in the dialect." });
  });
});
