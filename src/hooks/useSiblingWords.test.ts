import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aUserVocabulary, TEST_USER_ID } from "@/test/support/factories";
import { useSiblingWords } from "./useSiblingWords";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Words in the learner's deck sharing a root with the card in front of them.
 *
 * Arabic morphology is the reason this exists: كتب, كتاب, مكتب and كاتب are one
 * root away from each other, and seeing them together during review turns four
 * unrelated memorisations into one pattern. Surfacing the wrong siblings is
 * worse than surfacing none — a false connection is harder to unlearn than no
 * connection.
 *
 * So the query is narrow on purpose: same learner, same dialect, same root,
 * never the card itself.
 */

const ROOT = "ك ت ب";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const aWord = (index: number, over: Record<string, unknown> = {}) =>
  aUserVocabulary({
    id: `voc-${index}`,
    user_id: TEST_USER_ID,
    word_arabic: `كلمة${index}`,
    word_english: `word ${index}`,
    root: ROOT,
    dialect: "Gulf",
    ...over,
  });

function render(
  params: { root?: string | null; excludeId?: string; dialect?: string; enabled?: boolean },
  rows: Record<string, unknown>[] = [],
) {
  const seed = (backend: SupabaseBackend) => backend.db.seed("user_vocabulary", rows);
  const harness = renderHookWithProviders(
    () =>
      useSiblingWords({
        root: params.root === undefined ? ROOT : params.root,
        excludeId: params.excludeId ?? "voc-0",
        dialect: params.dialect ?? "Gulf",
        enabled: params.enabled,
      }),
    { persona: "free", seed },
  );
  cleanup = harness.cleanup;
  return harness;
}

describe("finding siblings", () => {
  it("returns the other words sharing the root", async () => {
    const { result } = render({}, [aWord(0), aWord(1), aWord(2)]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((w) => w.id)).toEqual(["voc-1", "voc-2"]);
  });

  it("never returns the card being reviewed", async () => {
    const { result } = render({ excludeId: "voc-1" }, [aWord(0), aWord(1), aWord(2)]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Showing the card as its own sibling is the sort of thing that reads as a
    // rendering bug rather than a data one.
    expect(result.current.data?.map((w) => w.id)).toEqual(["voc-0", "voc-2"]);
  });

  it("leaves out words on a different root", async () => {
    const { result } = render({}, [aWord(0), aWord(1), aWord(2, { root: "د ر س" })]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((w) => w.id)).toEqual(["voc-1"]);
  });

  it("leaves out words in another dialect", async () => {
    const { result } = render({ dialect: "Gulf" }, [
      aWord(0),
      aWord(1),
      aWord(2, { dialect: "Egyptian" }),
    ]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The same root behaves differently across dialects; mixing them teaches a
    // pattern that does not hold.
    expect(result.current.data?.map((w) => w.id)).toEqual(["voc-1"]);
  });

  it("leaves out another learner's words", async () => {
    const { result } = render({}, [aWord(0), aWord(1), aWord(2, { user_id: "someone-else" })]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((w) => w.id)).toEqual(["voc-1"]);
  });

  it("returns an empty list when there are no siblings", async () => {
    const { result } = render({}, [aWord(0)]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Empty rather than null: the caller renders a list, and a missing array
    // is a different branch from an empty one.
    expect(result.current.data).toEqual([]);
  });

  it("caps the panel at six", async () => {
    const { result } = render(
      {},
      Array.from({ length: 12 }, (_, index) => aWord(index)),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The panel sits beside a flashcard; twelve siblings would bury the card
    // it is meant to illuminate.
    expect(result.current.data).toHaveLength(6);
  });

  it("carries what the panel renders", async () => {
    const { result } = render({}, [
      aWord(0),
      aWord(1, {
        word_arabic: "كتاب",
        word_english: "book",
        image_url: "https://cdn.test/book.png",
        word_audio_url: "https://cdn.test/book.mp3",
      }),
    ]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({
      word_arabic: "كتاب",
      word_english: "book",
      root: ROOT,
      image_url: "https://cdn.test/book.png",
      word_audio_url: "https://cdn.test/book.mp3",
    });
  });
});

describe("when not to look", () => {
  it("does not query without a root", async () => {
    const { result } = render({ root: null }, [aWord(0), aWord(1)]);

    // Most saved words have no root yet — enrichment is best-effort — so this
    // is the common case, not an edge one.
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
  });

  it("treats a whitespace-only root as no root", async () => {
    const { result } = render({ root: "   " }, [aWord(0), aWord(1)]);

    // Otherwise every word with a blank root would be a sibling of every other
    // one.
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
  });

  it("does not query when disabled", async () => {
    const { result } = render({ enabled: false }, [aWord(0), aWord(1)]);

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
  });

  it("does not query for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(
      () => useSiblingWords({ root: ROOT, excludeId: "voc-0", dialect: "Gulf" }),
      { persona: "anonymous" },
    );
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
  });
});
