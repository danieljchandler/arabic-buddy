import { afterEach, describe, expect, it, vi } from "vitest";
import {
  celebrationGuardKey,
  hasCelebrated,
  localDateKey,
  markCelebrated,
  noteTasksTouchedToday,
  singerName,
  songAchievement,
  wereTasksTouchedToday,
} from "./celebrationSong";

/**
 * The memory behind "one song per thing finished". A song costs a generation,
 * so the failure to guard against is a replay, a reload or a re-render quietly
 * paying for another one.
 */

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("singerName", () => {
  it("uses the name the learner chose, tidied", () => {
    expect(singerName("  Layla   Hassan ")).toBe("Layla Hassan");
    expect(singerName("فاطمة")).toBe("فاطمة");
  });

  it("is null when there is nothing to sing", () => {
    expect(singerName(null)).toBeNull();
    expect(singerName(undefined)).toBeNull();
    expect(singerName("   ")).toBeNull();
  });
});

describe("the one-song-per-thing guard", () => {
  it("remembers what has been sung", () => {
    const event = { kind: "lesson_complete", entityId: "lesson-guard-1" } as const;
    expect(hasCelebrated(event)).toBe(false);
    markCelebrated(event);
    expect(hasCelebrated(event)).toBe(true);
  });

  it("keys on both the kind and the thing, so one video can sing twice for two reasons", () => {
    markCelebrated({ kind: "video_complete", entityId: "video-guard-1" });
    expect(hasCelebrated({ kind: "video_complete", entityId: "video-guard-1" })).toBe(true);
    // Finishing the video and then talking it through are two finish lines.
    expect(hasCelebrated({ kind: "review_conversation_complete", entityId: "video-guard-1" })).toBe(false);
    expect(hasCelebrated({ kind: "video_complete", entityId: "video-guard-2" })).toBe(false);
    expect(celebrationGuardKey({ kind: "video_complete", entityId: "v" })).toBe(
      "hakiya:celebrated:video_complete:v",
    );
  });

  it("survives a reload", () => {
    markCelebrated({ kind: "lesson_complete", entityId: "lesson-guard-2" });
    // A new page load forgets the module's memory but not localStorage; the
    // stored key is what carries the guard across.
    expect(localStorage.getItem("hakiya:celebrated:lesson_complete:lesson-guard-2")).toBe("1");
  });

  it("still holds when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const event = { kind: "lesson_complete", entityId: "lesson-guard-3" } as const;

    markCelebrated(event);

    // Private mode and some embedded frames refuse storage. Without the
    // in-memory copy every effect re-run would start another paid song.
    expect(hasCelebrated(event)).toBe(true);
  });
});

describe("localDateKey", () => {
  it("is the local calendar date, zero-padded", () => {
    expect(localDateKey(new Date(2026, 2, 5, 23, 59))).toBe("2026-03-05");
    expect(localDateKey(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });
});

describe("tasks touched today", () => {
  it("is false until a task is completed in this browser", () => {
    expect(wereTasksTouchedToday()).toBe(false);
    noteTasksTouchedToday();
    expect(wereTasksTouchedToday()).toBe(true);
  });

  it("resets with the date", () => {
    noteTasksTouchedToday(new Date(2026, 2, 5, 12));
    expect(wereTasksTouchedToday(new Date(2026, 2, 5, 22))).toBe(true);
    // Yesterday's tasks must not make today's "all done" sing at someone who
    // has not touched anything yet.
    expect(wereTasksTouchedToday(new Date(2026, 2, 6, 8))).toBe(false);
  });

  it("is false rather than throwing when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(wereTasksTouchedToday()).toBe(false);
  });
});

describe("what the song function is asked to sing about", () => {
  it("sends a badge by its id alone, so no text of the client's reaches a prompt", () => {
    expect(songAchievement({ kind: "badge_earned", entityId: "5b1e7a52-0d0c-4a55-9a43-9a0c3b2f6e11" })).toEqual({
      kind: "badge_earned",
      badgeId: "5b1e7a52-0d0c-4a55-9a43-9a0c3b2f6e11",
    });
  });

  it("sends every other kind as the kind alone, never the lesson or video id", () => {
    expect(songAchievement({ kind: "lesson_complete", entityId: "lesson-1" })).toEqual({ kind: "lesson_complete" });
    expect(songAchievement({ kind: "daily_tasks_complete", entityId: "2026-10-07" })).toEqual({
      kind: "daily_tasks_complete",
    });
  });

  it("sings each badge once: the guard is per badge, and apart from a lesson with the same id", () => {
    const badge = { kind: "badge_earned", entityId: "badge-guard-1" } as const;
    expect(hasCelebrated(badge)).toBe(false);
    markCelebrated(badge);
    expect(hasCelebrated(badge)).toBe(true);
    expect(hasCelebrated({ kind: "badge_earned", entityId: "badge-guard-2" })).toBe(false);
    expect(hasCelebrated({ kind: "lesson_complete", entityId: "badge-guard-1" })).toBe(false);
  });
});
