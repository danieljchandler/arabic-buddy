import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isMissingQuizColumn,
  markQuizColumnsMissing,
  quizColumnsAvailable,
  quizRatingFields,
  resetQuizColumnsForTests,
  withoutQuizFields,
} from "./quizRatingFields";

/**
 * What a rating was asked as, on the write that carries it (quiz Phase 8).
 * The columns are an owner action, so the write must work without them: the
 * device stops sending them for a day once the project refuses them, then
 * tries again.
 */

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  localStorage.clear();
  resetQuizColumnsForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  resetQuizColumnsForTests();
});

const AT = "2026-11-02T09:30:00.000Z";
const FLIP = { last_quiz_format: null, last_quiz_step: null, last_quiz_at: null };

describe("the fields", () => {
  it("carry the format and the step of the question, stamped with the rating's moment", () => {
    expect(quizRatingFields({ format: "picture-choice", step: 3 }, AT)).toEqual({
      last_quiz_format: "picture-choice",
      last_quiz_step: 3,
      last_quiz_at: AT,
    });
  });

  it("are nulls for a flip card, so the row does not keep the last question's", () => {
    expect(quizRatingFields(null, AT)).toEqual(FLIP);
    expect(quizRatingFields(undefined, AT)).toEqual(FLIP);
  });

  it("come off a write whole, leaving the rest", () => {
    expect(
      withoutQuizFields({ ease_factor: 3, last_quiz_format: "cloze", last_quiz_step: 2, last_quiz_at: AT }),
    ).toEqual({ ease_factor: 3 });
  });
});

describe("a project without the columns", () => {
  it("is recognised by what it says: PostgREST's schema cache, or Postgres", () => {
    expect(
      isMissingQuizColumn({
        code: "PGRST204",
        message: "Could not find the 'last_quiz_format' column of 'word_reviews' in the schema cache",
      }),
    ).toBe(true);
    expect(isMissingQuizColumn({ code: "42703", message: 'column "last_quiz_step" does not exist' })).toBe(true);
    expect(isMissingQuizColumn({ code: "PGRST204", message: "Could not find the 'last_quiz_at' column" })).toBe(true);
  });

  it("is not any other refusal, even of the same kind", () => {
    expect(isMissingQuizColumn({ code: "PGRST204", message: "Could not find the 'difficulty' column" })).toBe(false);
    expect(isMissingQuizColumn({ code: "23505", message: "last_quiz_format duplicate" })).toBe(false);
    expect(isMissingQuizColumn(null)).toBe(false);
  });

  it("stops the fields for a day, on this device, then tries them again", () => {
    const now = 1_800_000_000_000;
    expect(quizColumnsAvailable(now)).toBe(true);
    markQuizColumnsMissing(now);

    expect(quizRatingFields({ format: "cloze", step: 2 }, AT, now + 1000)).toEqual({});
    // A new page load remembers.
    resetQuizColumnsForTests();
    expect(quizColumnsAvailable(now + DAY - 1)).toBe(false);
    expect(quizColumnsAvailable(now + DAY)).toBe(true);
  });

  it("still stops them for the page load when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const now = 1_800_000_000_000;
    markQuizColumnsMissing(now);
    expect(quizColumnsAvailable(now + 1000)).toBe(false);
  });
});
