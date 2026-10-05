import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aUserVocabulary, daysAgo, TEST_USER_ID, vocabId } from "@/test/support/factories";
import type { SupabaseBackend } from "@/test/support/server/handler";
import type { DebriefPlan, QuizItem } from "@/lib/videoDebrief";
import { useAuth } from "./useAuth";
import {
  DebriefPlanError,
  useBackfillStudyGuides,
  useDebriefPlan,
  useDebriefWordReview,
  useRecordWordLookup,
} from "./useVideoDebrief";

/**
 * The debrief's data hooks.
 *
 * The plan and the look-ups are the two halves of what the tutor knows about
 * this learner and this video; the review write-back is the one place the
 * debrief changes anything outside itself, so it is held to doing exactly
 * what a recognition review in My Words does.
 */

const VIDEO = "aaaaaaaa-0000-4000-8000-000000000000";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const PLAN: DebriefPlan = {
  video: { id: VIDEO, title: "A clip", dialect: "Gulf", cefrLevel: "A2" },
  level: "A2",
  steps: ["gist", "comprehension", "questions", "recap"],
  quiz: [],
  shadow: [],
  marked: { saved: 0, lookedUp: 0 },
  questionCount: 3,
  preparedNow: false,
};

function render<T>(hook: () => T, seed?: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(hook, { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

describe("useDebriefPlan", () => {
  it("asks the function for this video's plan", async () => {
    const { result, backend } = render(
      () => useDebriefPlan(VIDEO),
      (b) => b.stubFunction("video-debrief", PLAN),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.steps).toEqual(PLAN.steps);
    expect(backend.lastCallTo("video-debrief")?.body).toEqual({ action: "plan", videoId: VIDEO });
  });

  it("carries the status and the function's own error key, for the page to pick its message", async () => {
    const { result } = render(
      () => useDebriefPlan(VIDEO),
      (b) =>
        b.stubFunctionFailure("video-debrief", 422, {
          error: "no_transcript",
          message: "This video has no transcript to talk about yet.",
        }),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error as DebriefPlanError;
    expect(error).toBeInstanceOf(DebriefPlanError);
    expect(error.status).toBe(422);
    expect(error.code).toBe("no_transcript");
    expect(error.message).toBe("This video has no transcript to talk about yet.");
  });

  it("waits until it is enabled", () => {
    const { result, backend } = render(
      () => useDebriefPlan(VIDEO, false),
      (b) => b.stubFunction("video-debrief", PLAN),
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(backend.callsTo("video-debrief")).toHaveLength(0);
  });
});

describe("useRecordWordLookup", () => {
  it("records one row per word per video, however often it is tapped", async () => {
    const { result, backend } = render(() => ({ record: useRecordWordLookup(VIDEO), auth: useAuth() }));
    // The session is restored asynchronously; a tap before it is there records nothing.
    await waitFor(() => expect(result.current.auth.user).not.toBeNull());
    act(() => result.current.record({ arabic: " تعبان ", english: "tired", lineId: "l2" }));
    await waitFor(() => expect(backend.db.raw("video_word_lookups")).toHaveLength(1));
    // A second tap on the same word, then a different word.
    act(() => {
      result.current.record({ arabic: "تعبان", english: "exhausted", lineId: "l2" });
      result.current.record({ arabic: "البارحة" });
    });
    await waitFor(() => expect(backend.db.raw("video_word_lookups")).toHaveLength(2));
    const rows = backend.db.raw("video_word_lookups");
    expect(rows.find((r) => r.word_arabic === "تعبان")).toMatchObject({
      user_id: TEST_USER_ID,
      video_id: VIDEO,
      word_english: "tired",
      line_id: "l2",
    });
  });

  it("records nothing without a video", async () => {
    const { result, backend } = render(() => useRecordWordLookup(undefined));
    act(() => result.current({ arabic: "تعبان" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.db.raw("video_word_lookups")).toHaveLength(0);
  });
});

describe("useDebriefWordReview", () => {
  const item = (vocabularyId?: string): QuizItem => ({
    id: "q1",
    arabic: "تعبان",
    english: "tired",
    source: vocabularyId ? "saved" : "key_vocab",
    vocabularyId,
    options: ["tired", "happy", "late"],
    answerIndex: 0,
  });

  it("reschedules the saved word's card as a recognition review", async () => {
    const id = vocabId(7);
    const { result, backend } = render(
      () => useDebriefWordReview(),
      (b) =>
        b.db.seed("user_vocabulary", [
          aUserVocabulary({ id, word_arabic: "تعبان", repetitions: 2, interval_days: 3, last_reviewed_at: daysAgo(3) }),
        ]),
    );
    let updated = false;
    await act(async () => {
      updated = await result.current(item(id), true);
    });
    expect(updated).toBe(true);
    const row = backend.db.raw("user_vocabulary").find((r) => r.id === id)!;
    expect(row.repetitions).toBe(3);
    expect(new Date(String(row.next_review_at)).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(String(row.last_reviewed_at)).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("counts a wrong answer as a lapse", async () => {
    const id = vocabId(8);
    const { result, backend } = render(
      () => useDebriefWordReview(),
      (b) => b.db.seed("user_vocabulary", [aUserVocabulary({ id, repetitions: 4, lapses: 1, last_reviewed_at: daysAgo(10) })]),
    );
    await act(async () => {
      await result.current(item(id), false);
    });
    expect(backend.db.raw("user_vocabulary").find((r) => r.id === id)!.lapses).toBe(2);
  });

  it("has nothing to move for a word that is not in My Words", async () => {
    const { result } = render(() => useDebriefWordReview());
    let updated = true;
    await act(async () => {
      updated = await result.current(item(undefined), true);
    });
    expect(updated).toBe(false);
  });
});

describe("useBackfillStudyGuides", () => {
  it("walks the backfill by cursor until nothing remains", async () => {
    const pages = [
      { results: [{ id: "a", status: "generated" }, { id: "b", status: "no_transcript" }], cursor: "b", remaining: 1, storeFailed: false },
      { results: [{ id: "c", status: "failed" }], cursor: "c", remaining: 0, storeFailed: false },
    ];
    let call = 0;
    const { result, backend } = render(
      () => useBackfillStudyGuides(),
      (b) => b.stubFunction("video-study-guide", () => ({ status: 200, body: pages[call++] })),
    );
    const progress: Array<[number, number]> = [];
    await act(async () => {
      await result.current.mutateAsync({ onProgress: (done, remaining) => progress.push([done, remaining]) });
    });
    expect(result.current.data).toEqual({ generated: 1, skipped: 1, failed: 1, storeFailed: false });
    expect(progress).toEqual([[2, 1], [3, 0]]);
    expect(backend.callsTo("video-study-guide").map((c) => (c.body as { after: unknown }).after)).toEqual([null, "b"]);
  });

  it("stops at once when the guides cannot be stored", async () => {
    const { result } = render(
      () => useBackfillStudyGuides(),
      (b) =>
        b.stubFunction("video-study-guide", {
          results: [{ id: "a", status: "generated" }],
          cursor: "a",
          remaining: 40,
          storeFailed: true,
        }),
    );
    await act(async () => {
      await result.current.mutateAsync({});
    });
    expect(result.current.data?.storeFailed).toBe(true);
  });
});
