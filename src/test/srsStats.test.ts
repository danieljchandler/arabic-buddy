import { describe, expect, it } from "vitest";
import {
  buildSRSForecast,
  computeSRSRetentionRate,
  createEmptyStageBreakdown,
  getSRSStageByRepetitions,
} from "@/lib/srsStats";

describe("srsStats helpers", () => {
  it("classifies stage boundaries by repetitions", () => {
    expect(getSRSStageByRepetitions(0)).toBe("new");
    expect(getSRSStageByRepetitions(1)).toBe("learning");
    expect(getSRSStageByRepetitions(2)).toBe("learning");
    expect(getSRSStageByRepetitions(3)).toBe("familiar");
    expect(getSRSStageByRepetitions(4)).toBe("familiar");
    expect(getSRSStageByRepetitions(5)).toBe("practiced");
    expect(getSRSStageByRepetitions(7)).toBe("practiced");
    expect(getSRSStageByRepetitions(8)).toBe("strong");
    expect(getSRSStageByRepetitions(12)).toBe("strong");
    expect(getSRSStageByRepetitions(13)).toBe("mastered");
  });

  it("builds a 7-day forecast and buckets overdue cards into today", () => {
    const now = new Date("2026-05-24T12:00:00Z");
    const forecast = buildSRSForecast(
      [
        "2026-05-20T10:00:00Z",
        "2026-05-24T01:00:00Z",
        "2026-05-25T10:00:00Z",
        "2026-05-30T23:00:00Z",
        "2026-06-01T10:00:00Z",
      ],
      now,
    );

    expect(forecast).toHaveLength(7);
    expect(forecast[0].label).toBe("Today");
    expect(forecast[1].label).toBe("Tomorrow");
    expect(forecast[0].count).toBe(2);
    expect(forecast[1].count).toBe(1);
    expect(forecast[6].count).toBe(1);
  });

  it("computes retention as non-again review percentage", () => {
    const retention = computeSRSRetentionRate([
      { repetitions: 10, lapses: 2 },
      { repetitions: 5, lapses: 1 },
      { repetitions: 0, lapses: 0 },
    ]);
    expect(retention).toBe(80);
  });

  it("creates a zeroed stage breakdown", () => {
    expect(createEmptyStageBreakdown()).toEqual({
      new: 0,
      learning: 0,
      familiar: 0,
      practiced: 0,
      strong: 0,
      mastered: 0,
    });
  });
});
