import { describe, expect, it, afterEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aUserVocabulary, daysAgo, vocabId, TEST_USER_ID } from "@/test/support/factories";
import { useAddUserVocabulary, useUserVocabulary } from "./useUserVocabulary";
import { useAuth } from "./useAuth";

/**
 * The saved-vocabulary query.
 *
 * Runs the real supabase-js client against the in-memory backend, so the URL
 * this hook builds is what is being tested. That is the point: a filter on the
 * wrong column, or a select naming one that no longer exists, produces an empty
 * list rather than an error — and a mocked query builder would return the
 * fixture either way and never notice.
 */

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

const OTHER_USER = "00000000-0000-4000-8000-000000000009";

describe("useUserVocabulary", () => {
  it("returns the signed-in learner's words", async () => {
    const rendered = renderHookWithProviders(() => useUserVocabulary(), {
      persona: "free",
      seed: (backend) =>
        backend.db.seed("user_vocabulary", [
          aUserVocabulary({ id: vocabId(0), word_arabic: "قلم", word_english: "pen" }),
          aUserVocabulary({ id: vocabId(1), word_arabic: "كتاب", word_english: "book" }),
        ]),
    });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.result.current.isSuccess).toBe(true));
    expect(rendered.result.current.data).toHaveLength(2);
  });

  it("does not return another learner's words", async () => {
    // The filter is the only thing standing between two accounts' vocabularies.
    const rendered = renderHookWithProviders(() => useUserVocabulary(), {
      persona: "free",
      seed: (backend) =>
        backend.db.seed("user_vocabulary", [
          aUserVocabulary({ id: vocabId(0), user_id: TEST_USER_ID, word_arabic: "مِلكي" }),
          aUserVocabulary({ id: vocabId(1), user_id: OTHER_USER, word_arabic: "لغيري" }),
        ]),
    });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.result.current.isSuccess).toBe(true));
    expect(rendered.result.current.data?.map((word) => word.word_arabic)).toEqual(["مِلكي"]);
  });

  it("returns only the active dialect by default", async () => {
    const rendered = renderHookWithProviders(() => useUserVocabulary(), {
      persona: "free",
      seed: (backend) =>
        backend.db.seed("user_vocabulary", [
          aUserVocabulary({ id: vocabId(0), dialect: "Gulf", word_arabic: "خليجي" }),
          aUserVocabulary({ id: vocabId(1), dialect: "Egyptian", word_arabic: "مصري" }),
        ]),
    });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.result.current.isSuccess).toBe(true));
    expect(rendered.result.current.data?.map((word) => word.word_arabic)).toEqual(["خليجي"]);
  });

  it("returns every dialect when asked to mix", async () => {
    const rendered = renderHookWithProviders(() => useUserVocabulary(true), {
      persona: "free",
      seed: (backend) =>
        backend.db.seed("user_vocabulary", [
          aUserVocabulary({ id: vocabId(0), dialect: "Gulf" }),
          aUserVocabulary({ id: vocabId(1), dialect: "Egyptian" }),
        ]),
    });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.result.current.isSuccess).toBe(true));
    expect(rendered.result.current.data).toHaveLength(2);
  });

  it("returns the newest first", async () => {
    const rendered = renderHookWithProviders(() => useUserVocabulary(), {
      persona: "free",
      seed: (backend) =>
        backend.db.seed("user_vocabulary", [
          aUserVocabulary({ id: vocabId(0), word_arabic: "أقدم", created_at: daysAgo(30) }),
          aUserVocabulary({ id: vocabId(1), word_arabic: "أحدث", created_at: daysAgo(1) }),
        ]),
    });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.result.current.isSuccess).toBe(true));
    expect(rendered.result.current.data?.[0].word_arabic).toBe("أحدث");
  });

  it("does not query at all for a signed-out visitor", async () => {
    // `enabled: !!user` keeps the query idle rather than firing one that would
    // be rejected by RLS anyway. It stays pending, which is why this asserts on
    // fetchStatus rather than waiting for a result that never comes.
    const rendered = renderHookWithProviders(() => useUserVocabulary(), {
      persona: "anonymous",
      seed: (backend) => backend.db.seed("user_vocabulary", [aUserVocabulary()]),
    });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.result.current.fetchStatus).toBe("idle"));
    expect(rendered.result.current.data).toBeUndefined();
    expect(rendered.backend.db.readsOf("user_vocabulary")).toHaveLength(0);
  });

  it("reports an error rather than an empty deck when the query fails", async () => {
    // An empty array here tells the learner they have saved nothing, which is
    // indistinguishable from a real empty state.
    const rendered = renderHookWithProviders(() => useUserVocabulary(), {
      persona: "free",
      seed: (backend) => backend.db.failAlways("user_vocabulary", 500),
    });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.result.current.isError).toBe(true));
    expect(rendered.result.current.data).toBeUndefined();
  });

  it("returns an empty list when the learner has saved nothing", async () => {
    const rendered = renderHookWithProviders(() => useUserVocabulary(), {
      persona: "free",
      seed: (backend) => backend.db.seed("user_vocabulary", []),
    });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.result.current.isSuccess).toBe(true));
    expect(rendered.result.current.data).toEqual([]);
  });
});

describe("useAddUserVocabulary — the video a word came from", () => {
  const VIDEO = "aaaaaaaa-0000-4000-8000-000000000000";
  const word = {
    word_arabic: "تعبان",
    word_english: "tired",
    source: "discover",
    sentence_text: "والله تعبان شوي",
    source_video_id: VIDEO,
  };

  it("records which video a saved word came from", async () => {
    const rendered = renderHookWithProviders(() => ({ add: useAddUserVocabulary(), auth: useAuth() }), {
      persona: "free",
    });
    cleanup = rendered.cleanup;
    await waitFor(() => expect(rendered.result.current.auth.user).not.toBeNull());
    await act(async () => {
      await rendered.result.current.add.mutateAsync(word);
    });
    expect(rendered.backend.db.raw("user_vocabulary")).toEqual([
      expect.objectContaining({ word_arabic: "تعبان", user_id: TEST_USER_ID, source_video_id: VIDEO }),
    ]);
  });

  it("still saves the word on a project where the column is not live yet", async () => {
    // What PostgREST answers for a column the migration has not created.
    const rendered = renderHookWithProviders(() => ({ add: useAddUserVocabulary(), auth: useAuth() }), {
      persona: "free",
      seed: (backend) =>
        backend.db.failNextWrite("user_vocabulary", 400, {
          code: "PGRST204",
          message: "Could not find the 'source_video_id' column of 'user_vocabulary' in the schema cache",
        }),
    });
    cleanup = rendered.cleanup;
    await waitFor(() => expect(rendered.result.current.auth.user).not.toBeNull());
    await act(async () => {
      await rendered.result.current.add.mutateAsync(word);
    });
    const rows = rendered.backend.db.raw("user_vocabulary");
    expect(rows).toHaveLength(1);
    expect(rows[0].word_arabic).toBe("تعبان");
    expect(rows[0].source_video_id ?? null).toBeNull();
  });
});
