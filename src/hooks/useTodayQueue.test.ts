import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import {
  aDiscoverVideo,
  aProfile,
  aSetPhrase,
  aUserSetPhrase,
  aUserVocabulary,
  aVocabularyWord,
  aWordReview,
  many,
  reviewId,
  setPhraseId,
  userSetPhraseId,
  videoId,
  vocabId,
  wordId,
} from "@/test/support/factories";
import { markTaskCompletedToday } from "@/lib/todayCompletion";
import { useTodayQueue, speakingSurfaceFor, type TodayTaskId } from "./useTodayQueue";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The daily queue on the home page.
 *
 * The first thing a signed-in learner sees, and the only place that combines
 * server state (three SRS decks, set phrases, available clips) with
 * localStorage completion. Two ways it goes wrong and neither is loud: a task
 * that stays visible after being done nags about work already finished, and one
 * that hides while work is outstanding means the learner never gets to it.
 */

let cleanup: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
  // The queue reads "today" from the clock; a run straddling midnight would
  // otherwise flip completions mid-test.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-03-11T12:00:00"));
});

afterEach(() => {
  cleanup?.();
  vi.useRealTimers();
});

/** Curriculum cards due, so the flashcards task has work. */
function seedDueCards(backend: SupabaseBackend, count: number) {
  backend.db.seed(
    "vocabulary_words",
    many(aVocabularyWord, count, (index) => ({ id: wordId(index) })),
  );
  backend.db.seed(
    "word_reviews",
    many(aWordReview, count, (index) => ({ id: reviewId(index), word_id: wordId(index) })),
  );
}

const taskById = (tasks: ReturnType<typeof useTodayQueue>, id: TodayTaskId) =>
  tasks.find((task) => task.id === id);

const visible = (tasks: ReturnType<typeof useTodayQueue>) =>
  tasks.filter((task) => !task.hidden).map((task) => task.id);

describe("the task list", () => {
  it("offers the nine daily tasks", async () => {
    const rendered = renderHookWithProviders(() => useTodayQueue(), { persona: "free" });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.result.current.length).toBe(9));
    expect(rendered.result.current.map((task) => task.id).sort()).toEqual([
      "daily-challenge",
      "daily-story",
      "flashcards",
      "listening",
      "mistake-drill",
      "reading",
      "set-phrases",
      "souq",
      "speaking",
    ]);
  });

  it("routes each task somewhere real", async () => {
    const rendered = renderHookWithProviders(() => useTodayQueue(), { persona: "free" });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.result.current.length).toBe(9));
    for (const task of rendered.result.current) {
      expect(task.route, `${task.id} has no route`).toMatch(/^\//);
    }
  });

  it("gives every task an estimate the goal ring can add up", async () => {
    const rendered = renderHookWithProviders(() => useTodayQueue(), { persona: "free" });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.result.current.length).toBe(9));
    for (const task of rendered.result.current) {
      expect(task.estMinutes).toBeGreaterThan(0);
      expect(task.xpEstimate).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("flashcards", () => {
  it("counts cards due across every deck, not just one", async () => {
    // This is the bug the task was rewritten to fix: it used to count only the
    // saved-vocabulary deck, so curriculum cards due never reached the queue.
    const rendered = renderHookWithProviders(() => useTodayQueue(), {
      persona: "free",
      seed: (backend) => {
        seedDueCards(backend, 2);
        backend.db.seed(
          "user_vocabulary",
          many(aUserVocabulary, 3, (index) => ({ id: vocabId(index) })),
        );
      },
    });
    cleanup = rendered.cleanup;

    await waitFor(() => {
      const task = taskById(rendered.result.current, "flashcards");
      expect(task?.countBadge).toBe("5");
    });
  });

  it("names the count in the title, singular and plural", async () => {
    const rendered = renderHookWithProviders(() => useTodayQueue(), {
      persona: "free",
      seed: (backend) => seedDueCards(backend, 1),
    });
    cleanup = rendered.cleanup;

    await waitFor(() =>
      expect(taskById(rendered.result.current, "flashcards")?.title).toBe("Review 1 word"),
    );
  });

  it("routes into the session entry point, which walks every deck", async () => {
    // Not /review/my-words: /review forwards past decks that are already clear.
    const rendered = renderHookWithProviders(() => useTodayQueue(), {
      persona: "free",
      seed: (backend) => seedDueCards(backend, 2),
    });
    cleanup = rendered.cleanup;

    await waitFor(() =>
      expect(taskById(rendered.result.current, "flashcards")?.route).toBe("/review"),
    );
  });

  it("hides itself when nothing is due and it was never started", async () => {
    // An always-visible "0 cards due" row is noise on the one screen that
    // should read as a to-do list.
    const rendered = renderHookWithProviders(() => useTodayQueue(), { persona: "free" });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(visible(rendered.result.current)).not.toContain("flashcards"));
  });

  it("stays visible once done today, so the day reads as complete", async () => {
    const rendered = renderHookWithProviders(() => useTodayQueue(), { persona: "free" });
    cleanup = rendered.cleanup;

    act(() => markTaskCompletedToday("flashcards"));

    await waitFor(() => {
      const task = taskById(rendered.result.current, "flashcards");
      expect(task?.hidden).toBeFalsy();
      expect(task?.done).toBe(true);
    });
  });

  it("scales the estimate with the number of cards, within bounds", async () => {
    const rendered = renderHookWithProviders(() => useTodayQueue(), {
      persona: "free",
      seed: (backend) => seedDueCards(backend, 200),
    });
    cleanup = rendered.cleanup;

    await waitFor(() => {
      const task = taskById(rendered.result.current, "flashcards");
      // Capped at 15 minutes — an honest estimate for 200 cards would make the
      // day look impossible.
      expect(task?.estMinutes).toBe(15);
    });
  });
});

describe("set phrases", () => {
  it("counts the phrases due", async () => {
    const rendered = renderHookWithProviders(() => useTodayQueue(), {
      persona: "free",
      seed: (backend) => {
        backend.db.seed(
          "set_phrases",
          many(aSetPhrase, 2, (index) => ({ id: setPhraseId(index) })),
        );
        backend.db.seed(
          "user_set_phrases",
          many(aUserSetPhrase, 2, (index) => ({
            id: userSetPhraseId(index),
            phrase_id: setPhraseId(index),
          })),
        );
      },
    });
    cleanup = rendered.cleanup;

    await waitFor(() =>
      expect(taskById(rendered.result.current, "set-phrases")?.countBadge).toBe("2"),
    );
  });

  it("hides when nothing is due and it was never started", async () => {
    const rendered = renderHookWithProviders(() => useTodayQueue(), { persona: "free" });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(visible(rendered.result.current)).not.toContain("set-phrases"));
  });
});

describe("the mistake drill", () => {
  const seedErrors = (backend: SupabaseBackend, targets: string[]) => {
    backend.db.seed(
      "learner_errors",
      targets.map((target, index) => ({
        id: `eeeeeeee-4444-4000-8000-00000000000${index}`,
        user_id: "00000000-0000-4000-8000-000000000001",
        dialect: "Gulf",
        source: "pronunciation",
        error_kind: "mispronunciation",
        target_arabic: target,
        produced_arabic: null,
        detail: {},
        word_id: null,
        user_vocabulary_id: null,
        resolved_at: null,
        created_at: new Date().toISOString(),
      })),
    );
  };

  it("stays hidden until enough distinct fossils pile up", async () => {
    // One or two stray mistakes are ordinary practice noise; a queue slot for
    // them would nag about nothing.
    const rendered = renderHookWithProviders(() => useTodayQueue(), {
      persona: "free",
      seed: (backend) => seedErrors(backend, ["مرحبا", "شلونك"]),
    });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.result.current.length).toBe(9));
    expect(visible(rendered.result.current)).not.toContain("mistake-drill");
  });

  it("earns a slot with a count once the threshold is crossed", async () => {
    const rendered = renderHookWithProviders(() => useTodayQueue(), {
      persona: "free",
      seed: (backend) => seedErrors(backend, ["مرحبا", "شلونك", "بكرة"]),
    });
    cleanup = rendered.cleanup;

    await waitFor(() => {
      const task = taskById(rendered.result.current, "mistake-drill");
      expect(task?.hidden).toBeFalsy();
      expect(task?.countBadge).toBe("3");
      expect(task?.route).toBe("/mistakes");
    });
  });

  it("stays visible as done after a drill even when the list has shrunk", async () => {
    const rendered = renderHookWithProviders(() => useTodayQueue(), { persona: "free" });
    cleanup = rendered.cleanup;

    act(() => markTaskCompletedToday("mistake-drill"));

    await waitFor(() => {
      const task = taskById(rendered.result.current, "mistake-drill");
      expect(task?.hidden).toBeFalsy();
      expect(task?.done).toBe(true);
    });
  });
});

describe("today's video", () => {
  // Still filed under the "listening" id: that is the key completions are
  // stored under in localStorage, and renaming it would un-tick the task for
  // everyone who had already watched today.
  it("appears when there is a clip to watch", async () => {
    const rendered = renderHookWithProviders(() => useTodayQueue(), {
      persona: "free",
      seed: (backend) =>
        backend.db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0), dialect: "Gulf" })]),
    });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(visible(rendered.result.current)).toContain("listening"));
    expect(taskById(rendered.result.current, "listening")?.title).toBe("Watch today's video");
  });

  it("routes straight to the clip rather than the browse list", async () => {
    // The point of the task is that the choice has already been made; dropping
    // the learner on a grid of thumbnails hands it back to them.
    const rendered = renderHookWithProviders(() => useTodayQueue(), {
      persona: "free",
      seed: (backend) =>
        backend.db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0), dialect: "Gulf" })]),
    });
    cleanup = rendered.cleanup;

    await waitFor(() =>
      expect(taskById(rendered.result.current, "listening")?.route).toBe(`/discover/${videoId(0)}`),
    );
  });

  it("appears on a dialect with no clips of its own", async () => {
    // The card this task drives is the top of the home page, so it has to be
    // there on every dialect — a Yemeni learner falls back to another dialect's
    // clip rather than to nothing.
    const rendered = renderHookWithProviders(() => useTodayQueue(), {
      persona: "free",
      seed: (backend) => {
        backend.db.seed("profiles", [aProfile({ preferred_dialect: "Yemeni" })]);
        backend.db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0), dialect: "Gulf" })]);
      },
    });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(visible(rendered.result.current)).toContain("listening"));
  });

  it("hides when there is nothing to watch", async () => {
    // Offering a task that leads to an empty page is worse than not offering
    // it — the learner cannot complete it and it never clears.
    const rendered = renderHookWithProviders(() => useTodayQueue(), {
      persona: "free",
      seed: (backend) => backend.db.seed("discover_videos", []),
    });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.result.current.length).toBe(9));
    expect(visible(rendered.result.current)).not.toContain("listening");
  });
});

describe("speaking", () => {
  it("is always offered — the queue used to have no production task at all", async () => {
    const rendered = renderHookWithProviders(() => useTodayQueue(), { persona: "free" });
    cleanup = rendered.cleanup;
    await waitFor(() => expect(taskById(rendered.result.current, "speaking")).toBeDefined());
    expect(visible(rendered.result.current)).toContain("speaking");
  });

  it("rotates the three production surfaces across consecutive days", () => {
    const routes = [0, 1, 2, 3].map((offset) =>
      speakingSurfaceFor(new Date(Date.UTC(2026, 2, 11 + offset, 12))).route,
    );
    expect(new Set(routes.slice(0, 3)).size).toBe(3);
    expect(routes[3]).toBe(routes[0]);
    for (const route of routes) {
      expect(["/monologue", "/set-phrases/practice", "/pronunciation"]).toContain(route);
    }
  });

  it("promises practice, never speed", () => {
    for (const offset of [0, 1, 2]) {
      const { title, subtitle } = speakingSurfaceFor(new Date(Date.UTC(2026, 2, 11 + offset, 12)));
      expect(`${title} ${subtitle}`).not.toMatch(/faster|fluent in|quick/i);
    }
  });

  it("reads as done once a speaking surface reports an attempt", async () => {
    const rendered = renderHookWithProviders(() => useTodayQueue(), { persona: "free" });
    cleanup = rendered.cleanup;
    await waitFor(() => expect(taskById(rendered.result.current, "speaking")?.done).toBe(false));
    act(() => markTaskCompletedToday("speaking"));
    await waitFor(() => expect(taskById(rendered.result.current, "speaking")?.done).toBe(true));
  });
});

describe("completion", () => {
  const alwaysShown: TodayTaskId[] = ["daily-challenge", "daily-story", "reading", "souq"];

  it("marks a task done once completed today", async () => {
    const rendered = renderHookWithProviders(() => useTodayQueue(), { persona: "free" });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.result.current.length).toBe(9));
    for (const id of alwaysShown) {
      expect(taskById(rendered.result.current, id)?.done).toBe(false);
    }

    act(() => alwaysShown.forEach(markTaskCompletedToday));

    await waitFor(() => {
      for (const id of alwaysShown) {
        expect(taskById(rendered.result.current, id)?.done).toBe(true);
      }
    });
  });

  it("updates when a task is completed on another screen", async () => {
    // The queue listens for the event rather than polling; without it a task
    // finished elsewhere stays unticked until a reload.
    const rendered = renderHookWithProviders(() => useTodayQueue(), { persona: "free" });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(taskById(rendered.result.current, "reading")?.done).toBe(false));

    act(() => markTaskCompletedToday("reading"));

    await waitFor(() => expect(taskById(rendered.result.current, "reading")?.done).toBe(true));
  });

  it("forgets yesterday's completions", async () => {
    act(() => markTaskCompletedToday("reading"));

    vi.setSystemTime(new Date("2026-03-12T09:00:00"));

    const rendered = renderHookWithProviders(() => useTodayQueue(), { persona: "free" });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(taskById(rendered.result.current, "reading")?.done).toBe(false));
  });
});

describe("when the server cannot be reached", () => {
  it("still offers the tasks that do not depend on it", async () => {
    // A failed count must not blank the home page; the reading, souq and
    // challenge tasks need nothing from the server to be actionable.
    const rendered = renderHookWithProviders(() => useTodayQueue(), {
      persona: "free",
      seed: (backend) => {
        backend.db.failAlways("word_reviews", 500);
        backend.db.failAlways("user_vocabulary", 500);
        backend.db.failAlways("discover_videos", 500);
      },
    });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.result.current.length).toBe(9));
    expect(visible(rendered.result.current)).toEqual(
      expect.arrayContaining(["daily-challenge", "reading", "souq"]),
    );
  });
});
