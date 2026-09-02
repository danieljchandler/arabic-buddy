import { beforeEach, describe, expect, it, vi } from "vitest";
import { programmeWeek, pronunciationFirstUse, PRONUNCIATION_PROGRAMME_WEEKS, recordPronunciationFirstUse } from "./programmeWeek";

const NOW = new Date("2026-09-02T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

beforeEach(() => window.localStorage.clear());

describe("programmeWeek", () => {
  it("is week 1 with no first use recorded", () => {
    expect(programmeWeek(null, NOW)).toMatchObject({ week: 1, of: PRONUNCIATION_PROGRAMME_WEEKS, complete: false, firstUse: null });
  });

  it("counts whole weeks from first use and caps at the programme length", () => {
    expect(programmeWeek(daysAgo(0), NOW).week).toBe(1);
    expect(programmeWeek(daysAgo(6), NOW).week).toBe(1);
    expect(programmeWeek(daysAgo(7), NOW).week).toBe(2);
    expect(programmeWeek(daysAgo(29), NOW).week).toBe(5);
    expect(programmeWeek(daysAgo(60), NOW)).toMatchObject({ week: 5, complete: true });
  });

  it("treats a garbage date as no first use", () => {
    expect(programmeWeek("not a date", NOW).firstUse).toBeNull();
  });
});

describe("first use", () => {
  it("records once and keeps the original date", () => {
    const first = recordPronunciationFirstUse(new Date("2026-08-01T00:00:00Z"));
    const again = recordPronunciationFirstUse(new Date("2026-09-01T00:00:00Z"));
    expect(first).toBe("2026-08-01T00:00:00.000Z");
    expect(again).toBe(first);
    expect(pronunciationFirstUse()).toBe(first);
  });

  it("survives a storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(recordPronunciationFirstUse()).toBeNull();
    expect(pronunciationFirstUse()).toBeNull();
    vi.restoreAllMocks();
  });
});
