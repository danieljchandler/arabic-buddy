import { describe, expect, it, vi } from "vitest";
import { LADDER_THRESHOLDS, rungForMemory, type QuizDirection } from "./quizLadder";
import {
  fetchQuizAnswers,
  formatQuizLadderReport,
  parseReportArgs,
  reportQuizLadder,
  wilsonInterval,
  type FetchLike,
  type LoggedQuizAnswer,
} from "./quizLadderReport";

/**
 * The ladder read back from real ratings (quiz Phase 8): what the report
 * counts, which answers may move a threshold, and where it says one should be.
 */

/** An answer asked on the ladder: the step and format the memory puts it on. */
function onLadder(
  stability: number,
  right: boolean,
  direction: QuizDirection = "recognition",
  learner = "learner-0",
): LoggedQuizAnswer {
  const rung = rungForMemory({ stability, repetitions: 3 }, direction);
  return {
    user_id: learner,
    direction,
    rating: right ? "good" : "again",
    quiz_format: rung.format,
    quiz_step: rung.step,
    stability_before: stability,
    repetitions_before: 3,
    repetitions_after: right ? 4 : 3,
  };
}

/** `n` answers at a stability, `rightShare` of them right, from six learners in turn. */
function many(n: number, stability: number, rightShare: number, direction?: QuizDirection): LoggedQuizAnswer[] {
  const right = Math.round(n * rightShare);
  return Array.from({ length: n }, (_, i) => onLadder(stability, i < right, direction, `learner-${i % 6}`));
}

const picture = (report: ReturnType<typeof reportQuizLadder>) => report.thresholds.find((t) => t.name === "pictureDays")!;

describe("what it counts", () => {
  it("tallies each step and each format as asked, and leaves out reviews with no question recorded", () => {
    const report = reportQuizLadder([
      onLadder(10, true),
      onLadder(10, false),
      onLadder(2, true),
      { ...onLadder(10, true), quiz_step: null, quiz_format: null },
      { ...onLadder(10, true), rating: null },
    ]);

    expect(report.rows).toBe(5);
    expect(report.unrecorded).toBe(2);
    expect(report.byStep).toEqual([
      { step: 2, answers: 1, right: 1, accuracy: 1 },
      { step: 4, answers: 2, right: 1, accuracy: 0.5 },
    ]);
    expect(report.byFormat.find((f) => f.format === "listen")).toEqual({ format: "listen", answers: 2, right: 1, accuracy: 0.5 });
  });

  it("counts a Hard as right: the learner recalled it", () => {
    const report = reportQuizLadder([{ ...onLadder(10, true), rating: "hard" }]);
    expect(report.byStep[0].right).toBe(1);
  });

  it("tells a boss and a fallback from the ladder's own question", () => {
    const report = reportQuizLadder([
      onLadder(10, true),
      // A boss: a first look, asked of a card whose memory says step 4.
      { ...onLadder(10, true), quiz_step: 1, quiz_format: "cloze-hint" },
      // Step 3 with no picture: the meaning asked instead.
      { ...onLadder(5, true), quiz_format: "meaning" },
    ]);

    expect(report.onLadder).toBe(1);
    expect(report.offLadder).toBe(1);
    expect(report.fallback).toBe(1);
  });

  it("reads a first review (no stability before) as asked at the first look", () => {
    const first: LoggedQuizAnswer = {
      user_id: "learner-0",
      direction: "recognition",
      rating: "good",
      quiz_format: "cloze-hint",
      quiz_step: 1,
      stability_before: null,
      repetitions_before: null,
      repetitions_after: 1,
    };
    expect(reportQuizLadder([first]).onLadder).toBe(1);
  });

  it("reads a lapse from the repetitions it had, which a lapse leaves as they were", () => {
    // A card on its first repetition, asked the gap (step 2) and missed:
    // repetitions stay at 1. Read as repetitions_after - 1, it would be a
    // first look, and the answer would count as off the ladder.
    const lapse: LoggedQuizAnswer = {
      user_id: "learner-0",
      direction: "recognition",
      rating: "again",
      quiz_format: "cloze",
      quiz_step: 2,
      stability_before: 2,
      repetitions_before: 1,
      repetitions_after: 1,
    };
    expect(reportQuizLadder([lapse])).toMatchObject({ onLadder: 1, offLadder: 0 });
    // And read back the same way from the rating, where the log has no count.
    expect(reportQuizLadder([{ ...lapse, repetitions_before: null }])).toMatchObject({ onLadder: 1, offLadder: 0 });
  });

  it("counts a question the app does not ask nowhere else", () => {
    const report = reportQuizLadder([
      onLadder(10, true),
      { ...onLadder(10, true), quiz_format: "Picture; drop" },
      { ...onLadder(10, true), quiz_format: "flashcard" },
      { ...onLadder(10, true), quiz_step: 42 },
    ]);
    expect(report).toMatchObject({ rows: 4, unknown: 3, onLadder: 1 });
    expect(report.byFormat.map((f) => f.format)).toEqual(["listen"]);
    expect(report.byStep.map((s) => s.step)).toEqual([4]);
  });
});

describe("where a threshold should be", () => {
  it("holds when the step it opens is answered right at the target from the threshold up", () => {
    const report = reportQuizLadder([...many(20, 8.5, 0.9), ...many(20, 13, 0.95)]);
    expect(picture(report)).toMatchObject({ verdict: "hold", settlesAt: LADDER_THRESHOLDS.pictureDays, proposed: 8 });
  });

  it("is raised to where the step's accuracy settles at the target", () => {
    // Just above 8 days the word heard alone is missed too often; from 8√2
    // (11.3) on, it is answered right.
    const report = reportQuizLadder([...many(20, 9, 0.6), ...many(40, 12, 0.95)]);
    expect(picture(report)).toMatchObject({ verdict: "raise", proposed: 11.3 });
  });

  it("says nothing on too few answers", () => {
    const report = reportQuizLadder(many(10, 12, 1));
    expect(picture(report)).toMatchObject({ verdict: "too-few", proposed: null, answers: 10 });
  });

  it("says nothing on too few learners, however many answers they gave", () => {
    const keen = Array.from({ length: 45 }, (_, i) => onLadder(i % 2 ? 9 : 13, true, "recognition", `learner-${i % 4}`));
    expect(picture(reportQuizLadder(keen))).toMatchObject({ verdict: "too-few", learners: 4, proposed: null });
  });

  it("counts each learner only so far toward a threshold", () => {
    const steady = [...many(20, 8.5, 0.9), ...many(20, 13, 0.95)];
    const keen = Array.from({ length: 200 }, () => onLadder(9, false, "recognition", "keen"));
    const report = reportQuizLadder([...steady, ...keen], { maxPerLearner: 10 });
    expect(picture(report)).toMatchObject({ answers: 50, learners: 7 });
  });

  it("takes a learner's answers evenly across them, not their first", () => {
    // A card climbs, so a learner's first answers are the lower ones: fifty
    // just over 8 days, then fifty over 11.3.
    const climbing = [
      ...Array.from({ length: 50 }, () => onLadder(9, true, "recognition", "keen")),
      ...Array.from({ length: 50 }, () => onLadder(12, true, "recognition", "keen")),
    ];
    const bands = picture(reportQuizLadder(climbing, { maxPerLearner: 10 })).bands;
    expect(bands.map((band) => band.answers)).toEqual([5, 5]);
  });

  it("is not raised on a thin band at the threshold", () => {
    // Five answers just above 8 days, all right, then plenty above: whether
    // 8 holds is not yet known, so neither holding nor raising is said.
    const report = reportQuizLadder([...many(5, 8.5, 1), ...many(40, 12, 0.95)]);
    expect(picture(report)).toMatchObject({ verdict: "unclear", proposed: null, settlesAt: null });
  });

  it("holds where the band at the threshold is under the target but not clearly so", () => {
    // 9 of 12 is 75%, but 12 answers cannot tell that from 85%.
    expect(wilsonInterval(9, 12).high).toBeGreaterThan(0.85);
    const report = reportQuizLadder([...many(12, 9, 0.75), ...many(40, 12, 0.95)]);
    expect(picture(report)).toMatchObject({ verdict: "hold", proposed: 8 });
  });

  it("says when the step never reaches the target in its range", () => {
    const report = reportQuizLadder([...many(30, 9, 0.5), ...many(30, 14, 0.6)]);
    expect(picture(report)).toMatchObject({ verdict: "never-settles", proposed: null });
  });

  it("is unclear, not never-settles, when the step is under the target but not clearly", () => {
    const report = reportQuizLadder([...many(30, 9, 0.8), ...many(30, 14, 0.8)]);
    expect(picture(report)).toMatchObject({ verdict: "unclear", proposed: null });
  });

  it("is not moved by a boss or a fallback, however they went", () => {
    const steady = [...many(20, 8.5, 0.9), ...many(20, 13, 0.95)];
    const noise = many(50, 9, 0).map((a) => ({ ...a, quiz_step: 1, quiz_format: "cloze-hint" }));
    const fallbacks = many(50, 9, 0).map((a) => ({ ...a, quiz_format: "meaning" }));
    expect(picture(reportQuizLadder([...steady, ...noise, ...fallbacks]))).toMatchObject({ verdict: "hold", proposed: 8 });
  });

  it("keeps each step's bands inside its range, and the top step open", () => {
    const report = reportQuizLadder([]);
    const gap = report.thresholds.find((t) => t.name === "firstLookDays")!;
    expect(gap.bands[0].from).toBe(LADDER_THRESHOLDS.firstLookDays);
    expect(gap.bands.at(-1)!.to).toBe(LADDER_THRESHOLDS.gapDays);
    const reply = report.thresholds.find((t) => t.name === "wordDays")!;
    expect(reply.bands.at(-1)!.to).toBeNull();
    const story = report.thresholds.find((t) => t.name === "storyDays")!;
    expect(story).toMatchObject({ direction: "production", step: 10 });
    expect(story.bands.at(-1)!.to).toBeNull();
  });

  it("reads the production side on its own schedule", () => {
    const report = reportQuizLadder([...many(20, 15, 0.9, "production"), ...many(20, 25, 0.95, "production")]);
    expect(report.thresholds.find((t) => t.name === "sentenceDays")).toMatchObject({ verdict: "hold", proposed: 14 });
  });
});

describe("Wilson's interval", () => {
  it("is wide on a few answers and narrows on many, around the share", () => {
    // The published 95% values for 9 of 10 and 900 of 1000.
    const few = wilsonInterval(9, 10);
    const lots = wilsonInterval(900, 1000);
    expect(few.low).toBeCloseTo(0.5958, 3);
    expect(few.high).toBeCloseTo(0.9821, 3);
    expect(lots.low).toBeCloseTo(0.8798, 3);
    expect(lots.high).toBeCloseTo(0.917, 3);
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe("the text", () => {
  it("says what was read and what each threshold should be", () => {
    const text = formatQuizLadderReport(reportQuizLadder([...many(20, 9, 0.6), ...many(40, 12, 0.95)]));
    expect(text).toContain("60 reviews read (curriculum reviews with a question recorded; flip cards are not); 60 on the ladder");
    expect(text).toContain("6 learners");
    expect(text).toContain("pictureDays");
    expect(text).toContain("raise from 8 to 11.3 days");
    expect(text).toContain("too few answers");
  });

  it("says when the answers do not decide", () => {
    const text = formatQuizLadderReport(reportQuizLadder([...many(5, 8.5, 1), ...many(40, 12, 0.95)]));
    expect(text).toContain("the answers do not decide yet (45, from 6 learners)");
  });
});

describe("reading the log", () => {
  const response = (body: unknown, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  const row = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    user_id: "learner-0",
    direction: "recognition",
    rating: "good",
    quiz_format: "listen",
    quiz_step: 4,
    stability_before: "9.5",
    repetitions_before: 3,
    repetitions_after: 4,
    ...extra,
  });

  it("reads curriculum reviews with a question recorded, a page at a time on the id, with the service role", async () => {
    const pages = [
      [row(1), row(2, { direction: "production", rating: "again", quiz_format: "speak", quiz_step: 7, stability_before: null, repetitions_before: null })],
      [row(5, { rating: "hard", quiz_format: "cloze", quiz_step: 2, stability_before: 2 })],
      [],
    ];
    const fetch = vi.fn<FetchLike>(async () => response(pages.shift() ?? []));

    const rows = await fetchQuizAnswers({
      supabaseUrl: "https://project.test",
      serviceRoleKey: "service",
      fetch,
      since: "2026-11-01",
      pageSize: 2,
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      user_id: "learner-0",
      direction: "recognition",
      rating: "good",
      quiz_format: "listen",
      quiz_step: 4,
      stability_before: 9.5,
      repetitions_before: 3,
      repetitions_after: 4,
    });
    expect(rows[1]).toMatchObject({ direction: "production", stability_before: null, repetitions_before: null });
    // A short page is not the end (the project may cap a page): it reads on
    // until a page comes back empty.
    expect(fetch).toHaveBeenCalledTimes(3);
    const [url, init] = fetch.mock.calls[0];
    const query = new URL(url).searchParams;
    expect(query.get("deck")).toBe("eq.word");
    expect(query.get("quiz_step")).toBe("not.is.null");
    expect(query.get("reviewed_at")).toBe("gte.2026-11-01");
    expect(query.get("order")).toBe("id.asc");
    expect(query.get("id")).toBeNull();
    expect(query.get("offset")).toBeNull();
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get("id")).toBe("gt.2");
    expect(new URL(fetch.mock.calls[2][0]).searchParams.get("id")).toBe("gt.5");
    expect(init).toMatchObject({ headers: { apikey: "service", Authorization: "Bearer service" }, redirect: "error" });
  });

  it("stops when a page does not move forward, rather than read the same rows again", async () => {
    const fetch = vi.fn<FetchLike>(async () => response([row(3)]));
    await expect(
      fetchQuizAnswers({ supabaseUrl: "https://project.test", serviceRoleKey: "k", fetch, since: "2026-11-01" }),
    ).rejects.toThrow(/did not move forward/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("stops on a failed read, rather than report on half the log", async () => {
    const fetch = vi.fn<FetchLike>(async () => response({ message: "nope" }, false, 401));
    await expect(
      fetchQuizAnswers({ supabaseUrl: "https://project.test", serviceRoleKey: "k", fetch, since: "2026-11-01" }),
    ).rejects.toThrow(/401/);
  });
});

describe("the script's arguments", () => {
  const now = new Date("2026-12-01T12:00:00Z");

  it("reads the last thirty days at 85% and thirty answers by default", () => {
    expect(parseReportArgs([], now)).toEqual({ since: "2026-11-01", target: 0.85, minAnswers: 30, json: false });
  });

  it("takes a start day, a target, a minimum and JSON", () => {
    expect(parseReportArgs(["--since", "2026-10-15", "--target", "0.9", "--min", "50", "--json"], now)).toEqual({
      since: "2026-10-15",
      target: 0.9,
      minAnswers: 50,
      json: true,
    });
  });

  it("refuses what it cannot use, rather than report on something else", () => {
    expect(parseReportArgs(["--since", "last month"], now)).toHaveProperty("error");
    expect(parseReportArgs(["--target", "85"], now)).toHaveProperty("error");
    expect(parseReportArgs(["--min", "0"], now)).toHaveProperty("error");
    expect(parseReportArgs(["--write"], now)).toHaveProperty("error");
    expect(parseReportArgs(["--help"], now)).toEqual({ help: true });
  });
});
