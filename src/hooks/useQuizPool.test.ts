import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aUserPhrase, aUserVocabulary, aVocabularyWord, many, phraseId, vocabId, wordId, TEST_USER_ID } from "@/test/support/factories";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { assetKey } from "../../supabase/functions/_shared/wordAssets";
import { useCurriculumWordPool, useSavedPhrasePool, useSavedWordPool } from "./useQuizPool";

/**
 * Where the quiz's wrong options come from. The pool must stay inside the
 * deck the card belongs to — a Gulf word's distractors are Gulf words, a
 * learner's saved words are theirs alone — and must cost the flashcards
 * nothing.
 */

const OTHER_USER = "00000000-0000-4000-8000-000000000009";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function seedCurriculum(backend: SupabaseBackend) {
  backend.db.seed("vocabulary_words", [
    ...many(aVocabularyWord, 3, (i) => ({ id: wordId(i), word_arabic: `كلمة${i}`, word_english: `word ${i}`, dialect_module: "Gulf" })),
    aVocabularyWord({ id: wordId(5), word_arabic: "مصري", word_english: "egyptian word", dialect_module: "Egyptian" }),
    aVocabularyWord({ id: wordId(6), word_arabic: "", word_english: "blank arabic", dialect_module: "Gulf" }),
  ]);
}

describe("the curriculum pool", () => {
  it("draws the dialect's words and nothing blank", async () => {
    const { result } = (() => {
      const r = renderHookWithProviders(() => useCurriculumWordPool("Gulf", false), { persona: "free", seed: seedCurriculum });
      cleanup = r.cleanup;
      return r;
    })();

    await waitFor(() => expect(result.current.data).toBeDefined());
    const english = result.current.data!.map((e) => e.english);
    expect(english).toEqual(["word 0", "word 1", "word 2"]);
  });

  it("carries each word's picture and recording for the picture and word questions", async () => {
    const r = renderHookWithProviders(() => useCurriculumWordPool("Gulf", false), {
      persona: "free",
      seed: (b) =>
        b.db.seed("vocabulary_words", [
          aVocabularyWord({ id: wordId(0), word_arabic: "بيت", word_english: "house", image_url: "https://img.test/house.png", audio_url: "https://audio.test/house.mp3" }),
          aVocabularyWord({ id: wordId(1), word_arabic: "مدرسة", word_english: "school" }),
        ]),
    });
    cleanup = r.cleanup;

    await waitFor(() => expect(r.result.current.data).toBeDefined());
    expect(r.result.current.data).toEqual([
      { arabic: "بيت", english: "house", imageUrl: "https://img.test/house.png", audioUrl: "https://audio.test/house.mp3" },
      { arabic: "مدرسة", english: "school", imageUrl: null, audioUrl: null },
    ]);
  });

  it("spans every dialect when the session does", async () => {
    const r = renderHookWithProviders(() => useCurriculumWordPool("Gulf", true), { persona: "free", seed: seedCurriculum });
    cleanup = r.cleanup;

    await waitFor(() => expect(r.result.current.data).toBeDefined());
    expect(r.result.current.data!.map((e) => e.english)).toContain("egyptian word");
  });

  it("reads nothing while the quiz is off", async () => {
    const r = renderHookWithProviders(() => useCurriculumWordPool("Gulf", false, false), { persona: "free", seed: seedCurriculum });
    cleanup = r.cleanup;

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(r.result.current.data).toBeUndefined();
    expect(r.backend.db.reads.filter((read) => read.table === "vocabulary_words")).toHaveLength(0);
  });

  it("is empty, not an error, when the read fails", async () => {
    const r = renderHookWithProviders(() => useCurriculumWordPool("Gulf", false), {
      persona: "free",
      seed: (b) => {
        seedCurriculum(b);
        b.db.failAlways("vocabulary_words");
      },
    });
    cleanup = r.cleanup;

    await waitFor(() => expect(r.result.current.data).toEqual([]));
    expect(r.result.current.isError).toBe(false);
  });
});

describe("the saved pools", () => {
  it("draws only the learner's own words, in their dialect", async () => {
    const r = renderHookWithProviders(() => useSavedWordPool("Gulf", false), {
      persona: "free",
      seed: (b) =>
        b.db.seed("user_vocabulary", [
          aUserVocabulary({ id: vocabId(0), word_arabic: "ملكي", word_english: "mine", dialect: "Gulf" }),
          aUserVocabulary({ id: vocabId(1), word_arabic: "مصري", word_english: "mine, egyptian", dialect: "Egyptian" }),
          aUserVocabulary({ id: vocabId(2), user_id: OTHER_USER, word_arabic: "لغيري", word_english: "theirs", dialect: "Gulf" }),
        ]),
    });
    cleanup = r.cleanup;

    await waitFor(() => expect(r.result.current.data).toBeDefined());
    expect(r.result.current.data).toEqual([{ arabic: "ملكي", english: "mine", imageUrl: null, audioUrl: null }]);
  });

  it("draws the learner's phrases the same way", async () => {
    const r = renderHookWithProviders(() => useSavedPhrasePool("Gulf", false), {
      persona: "free",
      seed: (b) =>
        b.db.seed("user_phrases", [
          aUserPhrase({ id: phraseId(0), user_id: TEST_USER_ID, phrase_arabic: "عبارتي", phrase_english: "my phrase" }),
          aUserPhrase({ id: phraseId(1), user_id: OTHER_USER, phrase_arabic: "عبارة غيري", phrase_english: "their phrase" }),
        ]),
    });
    cleanup = r.cleanup;

    await waitFor(() => expect(r.result.current.data).toBeDefined());
    expect(r.result.current.data).toEqual([{ arabic: "عبارتي", english: "my phrase", imageUrl: null, audioUrl: null }]);
  });

  it("waits for a signed-in learner", async () => {
    const r = renderHookWithProviders(() => useSavedWordPool("Gulf", false), { persona: "anonymous" });
    cleanup = r.cleanup;

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(r.result.current.data).toBeUndefined();
  });
});

describe("stored replies, for the reply question's wrong options", () => {
  /** A stored exchange for a word, as `word-asset` files it. */
  const anExchange = (conceptKey: string, word: string, dialect = "Gulf", over: Record<string, unknown> = {}) => ({
    id: `talk-${conceptKey}-${dialect}`,
    concept_key: conceptKey,
    kind: "dialogue",
    dialect,
    style_version: "text-1",
    url: null,
    payload: {
      lines: [
        { speaker: "Friend", arabic: "شو عندك؟", english: "What have you got?", transliteration: "" },
        { speaker: "Me", arabic: `عندي ${word} اليوم`, english: `I have ${word} today`, transliteration: "" },
      ],
    },
    meta: {},
    source: "generated",
    approved_at: null,
    created_at: "2026-10-09T00:00:00Z",
    ...over,
  });

  it("carries each curriculum word's stored reply, read in one query", async () => {
    const r = renderHookWithProviders(() => useCurriculumWordPool("Gulf", false), {
      persona: "free",
      seed: (b) => {
        b.db.seed("vocabulary_words", [
          aVocabularyWord({ id: wordId(0), word_arabic: "بيت", word_english: "house", dialect_module: "Gulf" }),
          aVocabularyWord({ id: wordId(1), word_arabic: "مدرسة", word_english: "school", dialect_module: "Gulf" }),
        ]);
        b.db.seed("word_assets", [
          anExchange("بيت|house", "بيت"),
          // Another dialect's exchange for the same word is not this deck's.
          anExchange("مدرسه|school", "مدرسة", "Egyptian"),
        ]);
      },
    });
    cleanup = r.cleanup;

    await waitFor(() => expect(r.result.current.data).toBeDefined());
    const [house, school] = r.result.current.data!;
    expect(house.dialogueLine).toMatchObject({ arabic: "عندي بيت اليوم", english: "I have بيت today" });
    expect(school.dialogueLine).toBeUndefined();
    expect(r.backend.db.readsOf("word_assets")).toHaveLength(1);
  });

  it("carries a saved word's stored reply, and reads the most settled words first", async () => {
    // More words than one read takes: the settled ones are the ones that have
    // reached the reply step.
    const words = many(aUserVocabulary, 130, (i) => ({
      id: vocabId(i),
      word_arabic: `كلمة${"ب".repeat(i % 5)}${i}`,
      word_english: `word ${i}`,
      dialect: "Gulf",
      ease_factor: i === 7 ? 90 : 1,
      created_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
    }));
    const seventh = String(words[7].word_arabic);
    const r = renderHookWithProviders(() => useSavedWordPool("Gulf", false), {
      persona: "free",
      seed: (b) => {
        b.db.seed("user_vocabulary", words);
        const key = assetKey({ kind: "dialogue", word: seventh, gloss: "word 7", dialect: "Gulf" });
        b.db.seed("word_assets", [anExchange(key!.conceptKey, seventh)]);
      },
    });
    cleanup = r.cleanup;

    await waitFor(() => expect(r.result.current.data).toBeDefined());
    const withReply = r.result.current.data!.filter((entry) => entry.dialogueLine);
    expect(withReply.map((entry) => entry.english)).toEqual(["word 7"]);
    expect(r.backend.db.readsOf("word_assets")).toHaveLength(1);
  });

  it("ignores a stored exchange whose reply does not use the word", async () => {
    const r = renderHookWithProviders(() => useCurriculumWordPool("Gulf", false), {
      persona: "free",
      seed: (b) => {
        b.db.seed("vocabulary_words", [aVocabularyWord({ id: wordId(0), word_arabic: "بيت", word_english: "house", dialect_module: "Gulf" })]);
        b.db.seed("word_assets", [anExchange("بيت|house", "مدرسة")]);
      },
    });
    cleanup = r.cleanup;

    await waitFor(() => expect(r.result.current.data).toBeDefined());
    expect(r.result.current.data![0].dialogueLine).toBeUndefined();
  });

  it("is the pool without replies, not an error, while the store's table is not there", async () => {
    const r = renderHookWithProviders(() => useCurriculumWordPool("Gulf", false), {
      persona: "free",
      seed: (b) => {
        seedCurriculum(b);
        b.db.failAlways("word_assets", 404, {
          code: "PGRST205",
          message: "Could not find the table 'public.word_assets' in the schema cache",
        });
      },
    });
    cleanup = r.cleanup;

    await waitFor(() => expect(r.result.current.data).toBeDefined());
    expect(r.result.current.data!.map((e) => e.english)).toEqual(["word 0", "word 1", "word 2"]);
    expect(r.result.current.data!.some((e) => e.dialogueLine)).toBe(false);
  });

  it("reads no stored replies for the phrase deck", async () => {
    const r = renderHookWithProviders(() => useSavedPhrasePool("Gulf", false), {
      persona: "free",
      seed: (b) => b.db.seed("user_phrases", [aUserPhrase({ id: phraseId(0), user_id: TEST_USER_ID })]),
    });
    cleanup = r.cleanup;

    await waitFor(() => expect(r.result.current.data).toBeDefined());
    expect(r.backend.db.readsOf("word_assets")).toEqual([]);
  });
});
