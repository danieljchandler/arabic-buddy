import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aUserPhrase, aUserVocabulary, aVocabularyWord, many, phraseId, vocabId, wordId, TEST_USER_ID } from "@/test/support/factories";
import type { SupabaseBackend } from "@/test/support/server/handler";
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
