import { describe, expect, it } from "vitest";
import {
  buildPhraseReviewRow,
  phraseRating,
  type PhraseAnswerMode,
  type UserSetPhrase,
} from "./useSetPhrases";

/**
 * Grading a set-phrase answer onto the deck's two schedules.
 *
 * The deck used to hold ONE schedule: a multiple-choice guess and a spoken
 * answer graded the same columns, so "can spot it" stood in for "can say it".
 * The production track is the fix, and the mapping is the part worth pinning:
 * a voice grade that lands only on the recognition columns silently recreates
 * the single-schedule deck, and nothing on the page would look wrong.
 */

const NOW = new Date("2026-09-01T12:00:00.000Z");

const existing = (over: Partial<UserSetPhrase> = {}): Partial<UserSetPhrase> => ({
  source: "manual_save",
  ease_factor: 4,
  difficulty: 5,
  interval_days: 3,
  repetitions: 2,
  last_reviewed_at: "2026-08-29T12:00:00.000Z",
  next_review_at: "2026-09-01T11:00:00.000Z",
  production_ease_factor: 2,
  production_difficulty: 5,
  production_interval_days: 1,
  production_repetitions: 1,
  production_lapses: 0,
  production_last_reviewed_at: "2026-08-31T12:00:00.000Z",
  production_next_review_at: "2026-09-01T11:00:00.000Z",
  ...over,
});

const grade = (
  quality: number,
  mode: PhraseAnswerMode,
  row: Partial<UserSetPhrase> | null = existing(),
) => buildPhraseReviewRow(quality, mode, row, NOW);

describe("quality → rating", () => {
  it("maps the voice scorer's bands the way the schedule expects", () => {
    expect(phraseRating(5)).toBe("easy");
    expect(phraseRating(4)).toBe("good");
    expect(phraseRating(3)).toBe("hard");
    expect(phraseRating(2)).toBe("again");
    expect(phraseRating(0)).toBe("again");
  });
});

describe("choice answers", () => {
  it("grades recognition and leaves the production schedule alone", () => {
    const row = grade(4, "choice");

    expect(row.next_review_at).toBeDefined();
    expect(row.repetitions).toBe(3);
    // No production grading — a guessed multiple-choice is not evidence the
    // learner can say the phrase.
    expect(row.production_ease_factor).toBeUndefined();
    expect(row.production_repetitions).toBeUndefined();
    expect(row.production_last_reviewed_at).toBeUndefined();
  });

  it("unlocks the production track on a confident answer", () => {
    const row = grade(4, "choice", existing({ production_next_review_at: null }));

    // The word decks' rule: production is a harder skill, so it opens once
    // recognition looks stable — due immediately, graded when spoken.
    expect(row.production_next_review_at).toBe(NOW.toISOString());
  });

  it("does not unlock production on a miss", () => {
    const row = grade(1, "choice", existing({ production_next_review_at: null }));
    expect(row.production_next_review_at).toBeUndefined();
  });

  it("never resets an already-running production schedule via the unlock", () => {
    const row = grade(5, "choice");
    // Unlock only fires when the track is locked; re-stamping "now" onto a
    // scheduled track would drag every phrase back to daily reviews.
    expect(row.production_next_review_at).toBeUndefined();
  });
});

describe("voice answers", () => {
  it("grades both tracks from the same rating", () => {
    const row = grade(4, "voice");

    expect(row.repetitions).toBe(3);
    expect(row.production_repetitions).toBe(2);
    expect(row.production_next_review_at).toBeDefined();
    expect(row.production_last_reviewed_at).toBe(NOW.toISOString());
    // Independent schedules: the two tracks entered with different stability,
    // so they must not come out with identical intervals.
    expect(row.production_interval_days).not.toBe(row.interval_days);
  });

  it("starts the production track even when it was still locked", () => {
    const row = grade(4, "voice", existing({ production_next_review_at: null, production_last_reviewed_at: null }));

    // Speaking is the stronger unlock — the learner just produced the phrase.
    expect(row.production_repetitions).toBe(2);
    expect(typeof row.production_next_review_at).toBe("string");
  });

  it("counts a failed take as a production lapse", () => {
    const row = grade(1, "voice", existing({ production_lapses: 2 }));
    expect(row.production_lapses).toBe(3);
  });

  it("does not count a passable take as a lapse", () => {
    const row = grade(3, "voice", existing({ production_lapses: 2 }));
    expect(row.production_lapses).toBe(2);
  });
});

describe("bookkeeping", () => {
  it("keeps the row's original source and records the quality", () => {
    const row = grade(4, "choice", existing({ source: "quiz_miss" }));
    expect(row.source).toBe("quiz_miss");
    expect(row.last_quality).toBe(4);
  });

  it("starts a brand-new row from scratch defaults", () => {
    const row = grade(4, "voice", null);
    expect(row.source).toBe("reviewed");
    expect(row.repetitions).toBe(1);
    expect(row.production_repetitions).toBe(1);
    expect(row.interval_days as number).toBeGreaterThanOrEqual(1);
  });

  it("never schedules an interval under one day", () => {
    const row = grade(1, "voice");
    expect(row.interval_days as number).toBeGreaterThanOrEqual(1);
    expect(row.production_interval_days as number).toBeGreaterThanOrEqual(1);
  });
});
