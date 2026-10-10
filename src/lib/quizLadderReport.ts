import { LADDER_THRESHOLDS, QUIZ_STEP_COUNT, rungForMemory, type QuizDirection, type QuizFormat } from "@/lib/quizLadder";

/**
 * The quiz ladder, read back from real ratings (quiz Phase 8).
 *
 * `LADDER_THRESHOLDS` are a first guess. Once `review_log` holds what each
 * curriculum rating was asked as (`quiz_format`, `quiz_step`, migration
 * 20261010130000_quiz_rating_asked), this reports how often each step and
 * each format is answered right, and, for each threshold, the stability from
 * which the step it opens is answered right about as often as the target
 * (85% by default). `scripts/quiz-ladder-report.ts` runs it over the live log;
 * this is the arithmetic, pure, so it can be tested on fixtures.
 *
 * Three kinds of answer, told apart by recomputing the step from the memory
 * the card was asked from (`stability_before`, and `repetitions_before`, which
 * the same migration logs: `repetitions_after - 1` is wrong for a lapse,
 * which leaves repetitions as they were):
 *
 * - on the ladder: asked at that step, in that step's own format. Only these
 *   set a threshold.
 * - a fallback: asked at that step in another format, for want of material
 *   (no picture, no recording, no device that records).
 * - off the ladder: asked at another step. A boss is (a first look whatever
 *   its stability); so is a row logged under thresholds since changed, where
 *   the change moved its step.
 *
 * A threshold is judged on evidence, not on a share alone. It needs enough
 * answers from enough learners (one keen learner's hundred answers are one
 * learner, so each counts at most `maxPerLearner` toward a threshold, an even
 * sample across their answers rather than their first, lower ones), enough
 * answers at the stability it would be set to, and the bands it is moved past
 * clearly below the target (the Wilson interval's top under it). Where the
 * answers are there but do not decide, it says so ("unclear") rather than
 * moving a threshold on noise.
 *
 * What it cannot say: whether a threshold could come down. On the ladder, a
 * step's own question is never asked below its threshold (a boss or a
 * fallback can be, and neither counts), so the log has no answers there; a
 * threshold the step clears from its first band is reported as holding, and
 * lowering it would take an experiment that asks below it.
 */

/** One logged curriculum review, as the report reads it. */
export interface LoggedQuizAnswer {
  user_id: string;
  direction: QuizDirection;
  rating: string | null;
  quiz_format: string | null;
  quiz_step: number | null;
  stability_before: number | null;
  /** Logged with the question; null on a first review (an insert). */
  repetitions_before: number | null;
  repetitions_after: number | null;
}

export interface Tally {
  answers: number;
  right: number;
  /** right / answers, or null with no answers. */
  accuracy: number | null;
}

export interface Band extends Tally {
  /** Stability (days) from, inclusive. */
  from: number;
  /** Stability to, exclusive; null for the top step's open end. */
  to: number | null;
}

/**
 * - hold: answered right at the target from the threshold up.
 * - raise: missed below `proposed`, clearly, and answered right from it up.
 * - too-few: not enough answers, or not enough learners, to say anything.
 * - never-settles: missed, clearly, in the answers across the step's range
 *   (which may sit in one band of it: the text says "in the answers").
 * - unclear: enough answers, but they do not decide (thin at the threshold,
 *   or below the target without being clearly so).
 */
export type ThresholdVerdict = "hold" | "raise" | "too-few" | "never-settles" | "unclear";

export interface ThresholdReport {
  name: keyof typeof LADDER_THRESHOLDS;
  direction: QuizDirection;
  /** The step this threshold opens. */
  step: number;
  current: number;
  /** On-ladder answers at that step, at most `maxPerLearner` from each learner. */
  answers: number;
  /** Learners those answers came from. */
  learners: number;
  bands: Band[];
  /** The lowest stability from which the step is answered right at the target, or null. */
  settlesAt: number | null;
  /** What to set it to: the same when it holds, higher when it is raised, null when the log cannot say. */
  proposed: number | null;
  verdict: ThresholdVerdict;
}

export interface QuizLadderReport {
  target: number;
  minAnswers: number;
  minLearners: number;
  /** Rows read. */
  rows: number;
  /** Learners the rows came from. */
  learners: number;
  /**
   * Rows read with a step but no format or no rating. Flip cards and rows
   * logged before the columns have no step, and `fetchQuizAnswers` does not
   * read them at all.
   */
  unrecorded: number;
  /** Rows recording a question the app does not ask: not counted anywhere else. */
  unknown: number;
  onLadder: number;
  fallback: number;
  offLadder: number;
  byStep: Array<{ step: number } & Tally>;
  byFormat: Array<{ format: string } & Tally>;
  thresholds: ThresholdReport[];
}

export interface ReportOptions {
  /** The share of right answers a step should get. */
  target?: number;
  /** Fewest answers to say anything about a threshold. */
  minAnswers?: number;
  /** Fewest answers in a band: to be set to it, or to count against settling. */
  minBandAnswers?: number;
  /** Fewest learners to say anything about a threshold. */
  minLearners?: number;
  /** Most answers one learner counts toward a threshold. */
  maxPerLearner?: number;
}

/** Each threshold, the direction it is on, and the step it opens (rungForMemory). */
const BOUNDARIES: ReadonlyArray<{ name: keyof typeof LADDER_THRESHOLDS; direction: QuizDirection; step: number }> = [
  { name: "firstLookDays", direction: "recognition", step: 2 },
  { name: "gapDays", direction: "recognition", step: 3 },
  { name: "pictureDays", direction: "recognition", step: 4 },
  { name: "hearDays", direction: "recognition", step: 5 },
  { name: "wordDays", direction: "recognition", step: 6 },
  { name: "sentenceDays", direction: "production", step: 8 },
  { name: "replyDays", direction: "production", step: 9 },
  { name: "storyDays", direction: "production", step: 10 },
];

const RIGHT = new Set(["hard", "good", "easy"]);

/**
 * The formats the quiz asks and records (QuizCardFrame's `onGraded`). The
 * flip card is not one: it is rated, not asked, and records nulls. Typed so
 * that a format added to the ladder has to be added here.
 */
const ASKED_FORMATS: ReadonlySet<string> = new Set(
  Object.keys({
    "cloze-hint": true,
    cloze: true,
    meaning: true,
    "picture-choice": true,
    listen: true,
    "word-choice": true,
    "reply-choice": true,
    speak: true,
    "speak-sentence": true,
    "speak-reply": true,
    "story-gap": true,
    "story-choice": true,
  } satisfies Record<Exclude<QuizFormat, "flashcard">, true>),
);

/** Wilson's 95% interval for a share: what `right` of `answers` says about the real one. */
export function wilsonInterval(right: number, answers: number, z = 1.96): { low: number; high: number } {
  if (answers <= 0) return { low: 0, high: 1 };
  const share = right / answers;
  const z2 = z * z;
  const centre = (share + z2 / (2 * answers)) / (1 + z2 / answers);
  const half = (z * Math.sqrt((share * (1 - share)) / answers + z2 / (4 * answers * answers))) / (1 + z2 / answers);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** One more answer under a key: [answers, right]. */
function count<K>(map: Map<K, [number, number]>, key: K, right: boolean): void {
  const [answers, rightCount] = map.get(key) ?? [0, 0];
  map.set(key, [answers + 1, rightCount + (right ? 1 : 0)]);
}

function tally(answers: number, right: number): Tally {
  return { answers, right, accuracy: answers > 0 ? right / answers : null };
}

/**
 * The memory a review was asked from, as the log keeps it. A row without
 * `repetitions_before` (none should have a question recorded, since both
 * arrive with the same migration) is read back from the rating: a lapse
 * leaves repetitions as they were, anything else adds one.
 */
function memoryBefore(row: LoggedQuizAnswer) {
  if (row.stability_before == null) return { stability: 0, repetitions: 0 };
  const after = row.repetitions_after ?? 0;
  return {
    stability: row.stability_before,
    repetitions: row.repetitions_before ?? (row.rating === "again" ? after : Math.max(after - 1, 0)),
  };
}

/** Answers and right answers, summed. */
function pool(bands: readonly Tally[]): { answers: number; right: number } {
  return bands.reduce((sum, band) => ({ answers: sum.answers + band.answers, right: sum.right + band.right }), {
    answers: 0,
    right: 0,
  });
}

/**
 * At most `cap` answers from each learner: an even sample across all of
 * theirs, not the first, which would lean on the lower stabilities a card
 * passes through first.
 */
function capPerLearner<T extends { row: LoggedQuizAnswer }>(answers: readonly T[], cap: number): T[] {
  const byLearner = new Map<string, T[]>();
  for (const answer of answers) {
    const theirs = byLearner.get(answer.row.user_id) ?? [];
    theirs.push(answer);
    byLearner.set(answer.row.user_id, theirs);
  }
  const kept = new Set<T>();
  for (const theirs of byLearner.values()) {
    if (theirs.length <= cap) theirs.forEach((answer) => kept.add(answer));
    else for (let i = 0; i < cap; i++) kept.add(theirs[Math.floor((i * theirs.length) / cap)]);
  }
  return answers.filter((answer) => kept.has(answer));
}

/** Half-octave bands from a threshold up to the next one in its direction (or open). */
function bandEdges(from: number, to: number | null): Array<{ from: number; to: number | null }> {
  const edges: Array<{ from: number; to: number | null }> = [];
  let low = from;
  for (let i = 1; i <= 12; i++) {
    const high = from * Math.SQRT2 ** i;
    if (to != null && high >= to) {
      edges.push({ from: low, to });
      return edges;
    }
    edges.push({ from: low, to: high });
    low = high;
  }
  edges.push({ from: low, to });
  return edges;
}

/** The next threshold above this one on the same direction, or null at the top. */
function nextThreshold(index: number): number | null {
  const here = BOUNDARIES[index];
  const next = BOUNDARIES.slice(index + 1).find((b) => b.direction === here.direction);
  return next ? LADDER_THRESHOLDS[next.name] : null;
}

export function reportQuizLadder(rows: readonly LoggedQuizAnswer[], options: ReportOptions = {}): QuizLadderReport {
  const target = options.target ?? 0.85;
  const minAnswers = options.minAnswers ?? 30;
  const minBandAnswers = options.minBandAnswers ?? 10;
  const minLearners = options.minLearners ?? 5;
  const maxPerLearner = options.maxPerLearner ?? 50;

  const steps = new Map<number, [number, number]>();
  const formats = new Map<string, [number, number]>();
  const onLadder: Array<{ row: LoggedQuizAnswer; stability: number; right: boolean }> = [];
  let unrecorded = 0;
  let unknown = 0;
  let fallback = 0;
  let offLadder = 0;

  for (const row of rows) {
    if (row.quiz_step == null || !row.quiz_format || !row.rating) {
      unrecorded++;
      continue;
    }
    if (
      !ASKED_FORMATS.has(row.quiz_format) ||
      !Number.isInteger(row.quiz_step) ||
      row.quiz_step < 1 ||
      row.quiz_step > QUIZ_STEP_COUNT
    ) {
      unknown++;
      continue;
    }
    const right = RIGHT.has(row.rating);
    count(steps, row.quiz_step, right);
    count(formats, row.quiz_format, right);

    const memory = memoryBefore(row);
    const rung = rungForMemory(memory, row.direction);
    if (rung.step !== row.quiz_step) offLadder++;
    else if (rung.format !== row.quiz_format) fallback++;
    else onLadder.push({ row, stability: memory.stability, right });
  }

  const thresholds = BOUNDARIES.map((boundary, index): ThresholdReport => {
    const current = LADDER_THRESHOLDS[boundary.name];
    const at = capPerLearner(
      onLadder.filter((a) => a.row.direction === boundary.direction && a.row.quiz_step === boundary.step),
      maxPerLearner,
    );
    const learners = new Set(at.map((a) => a.row.user_id)).size;
    const bands = bandEdges(current, nextThreshold(index)).map((edge) => {
      const inBand = at.filter((a) => a.stability >= edge.from && (edge.to == null || a.stability < edge.to));
      return { ...edge, ...tally(inBand.length, inBand.filter((a) => a.right).length) };
    });

    // Clearly below the target: the top of its interval under it, on enough answers.
    const clearlyMissed = (band: Tally) =>
      band.answers >= minBandAnswers && wilsonInterval(band.right, band.answers).high < target;

    // The lowest band it could be set to: enough answers there, enough from
    // there up and right at the target, and no band above clearly missed.
    let settles: number | null = null;
    for (let i = 0; i < bands.length; i++) {
      const above = pool(bands.slice(i));
      if (
        bands[i].answers >= minBandAnswers &&
        above.answers >= minAnswers &&
        above.right / above.answers >= target &&
        !bands.slice(i).some(clearlyMissed)
      ) {
        settles = i;
        break;
      }
    }

    const missedBelow = (to: number) => {
      const below = pool(bands.slice(0, to));
      return below.answers >= minBandAnswers && wilsonInterval(below.right, below.answers).high < target;
    };
    const verdict: ThresholdVerdict =
      at.length < minAnswers || learners < minLearners
        ? "too-few"
        : settles === 0
          ? "hold"
          : settles != null
            ? missedBelow(settles)
              ? "raise"
              : "unclear"
            : missedBelow(bands.length)
              ? "never-settles"
              : "unclear";
    const settlesAt = verdict === "hold" || verdict === "raise" ? bands[settles!].from : null;
    return {
      ...boundary,
      current,
      answers: at.length,
      learners,
      bands,
      settlesAt,
      proposed: verdict === "hold" ? current : verdict === "raise" ? round(settlesAt!) : null,
      verdict,
    };
  });

  return {
    target,
    minAnswers,
    minLearners,
    rows: rows.length,
    learners: new Set(rows.map((row) => row.user_id)).size,
    unrecorded,
    unknown,
    onLadder: onLadder.length,
    fallback,
    offLadder,
    byStep: [...steps.entries()].sort(([a], [b]) => a - b).map(([step, [answers, right]]) => ({ step, ...tally(answers, right) })),
    byFormat: [...formats.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([format, [answers, right]]) => ({ format, ...tally(answers, right) })),
    thresholds,
  };
}

function round(days: number): number {
  return Math.round(days * 10) / 10;
}

const percent = (accuracy: number | null) => (accuracy == null ? "  —" : `${Math.round(accuracy * 100)}%`.padStart(4));

/** The report as text, for the script to print. */
export function formatQuizLadderReport(report: QuizLadderReport): string {
  const lines = [
    `Quiz ladder report: ${report.rows} reviews read (curriculum reviews with a question recorded; flip cards are not); ${report.onLadder} on the ladder, ${report.fallback} fallbacks, ` +
      `${report.offLadder} off it (a boss, or older thresholds), ${report.unrecorded} with a step but no format or rating, ` +
      `${report.unknown} recording a question the app does not ask. ${report.learners} learners.`,
    `Target: ${Math.round(report.target * 100)}% right; a threshold needs ${report.minAnswers} answers ` +
      `from ${report.minLearners} learners to say anything.`,
    "",
    "By step (as asked):",
    ...report.byStep.map((s) => `  step ${String(s.step).padStart(2)}  ${percent(s.accuracy)}  of ${s.answers}`),
    "",
    "By format:",
    ...report.byFormat.map((f) => `  ${f.format.padEnd(16)} ${percent(f.accuracy)}  of ${f.answers}`),
    "",
    "Thresholds:",
  ];
  for (const t of report.thresholds) {
    const what =
      t.verdict === "too-few"
        ? `too few answers (${t.answers}, from ${t.learners} learners)`
        : t.verdict === "never-settles"
          ? `never reaches the target in the answers above ${t.current} days`
          : t.verdict === "unclear"
            ? `the answers do not decide yet (${t.answers}, from ${t.learners} learners)`
            : t.verdict === "hold"
              ? `holds at ${t.current} days (lowering it needs answers below it, which the ladder does not ask)`
              : `raise from ${t.current} to ${t.proposed} days`;
    lines.push(`  ${t.name.padEnd(14)} (${t.direction}, opens step ${t.step}): ${what}`);
    for (const band of t.bands) {
      if (band.answers === 0) continue;
      const range = `${round(band.from)}–${band.to == null ? "" : round(band.to)}`;
      lines.push(`      ${range.padEnd(12)} ${percent(band.accuracy)}  of ${band.answers}`);
    }
  }
  return lines.join("\n");
}

// ── Reading the log ──────────────────────────────────────────────────────────

export type FetchLike = (input: string, init?: { headers?: Record<string, string>; redirect?: "error" }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

/**
 * Every curriculum review with a question recorded since a day, a page at a
 * time, with the service role (review_log is readable only by its owner
 * otherwise). Read-only.
 *
 * Paged on the id, not an offset, so a row logged during the read neither
 * shifts a page nor is read twice; and read until a page comes back empty,
 * since the project may cap a page below the size asked for. A redirect is an
 * error: the key is not sent on to wherever it points.
 */
export async function fetchQuizAnswers(ctx: {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetch: FetchLike;
  since: string;
  pageSize?: number;
}): Promise<LoggedQuizAnswer[]> {
  const pageSize = ctx.pageSize ?? 1000;
  const rows: LoggedQuizAnswer[] = [];
  for (let after: number | null = null; ; ) {
    const query = new URLSearchParams({
      select: "id,user_id,direction,rating,quiz_format,quiz_step,stability_before,repetitions_before,repetitions_after",
      deck: "eq.word",
      quiz_step: "not.is.null",
      reviewed_at: `gte.${ctx.since}`,
      order: "id.asc",
      limit: String(pageSize),
    });
    if (after != null) query.set("id", `gt.${after}`);
    const response = await ctx.fetch(`${ctx.supabaseUrl}/rest/v1/review_log?${query}`, {
      headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` },
      redirect: "error",
    });
    if (!response.ok) throw new Error(`review_log read failed (${response.status}): ${await response.text()}`);
    const page = (await response.json()) as Array<Record<string, unknown>>;
    if (page.length === 0) return rows;
    for (const raw of page) {
      rows.push({
        user_id: String(raw.user_id),
        direction: raw.direction === "production" ? "production" : "recognition",
        rating: typeof raw.rating === "string" ? raw.rating : null,
        quiz_format: typeof raw.quiz_format === "string" ? raw.quiz_format : null,
        quiz_step: raw.quiz_step == null ? null : Number(raw.quiz_step),
        stability_before: raw.stability_before == null ? null : Number(raw.stability_before),
        repetitions_before: raw.repetitions_before == null ? null : Number(raw.repetitions_before),
        repetitions_after: raw.repetitions_after == null ? null : Number(raw.repetitions_after),
      });
    }
    const last = Number(page[page.length - 1].id);
    if (!Number.isFinite(last) || (after != null && last <= after)) {
      throw new Error("review_log read did not move forward; stopping rather than read the same rows again");
    }
    after = last;
  }
}

// ── The script's arguments ───────────────────────────────────────────────────

export interface ReportArgs {
  /** The first day of ratings read, YYYY-MM-DD. */
  since: string;
  target: number;
  minAnswers: number;
  json: boolean;
}

export const REPORT_USAGE = `Usage: npm run quiz:ladder-report -- [--since YYYY-MM-DD] [--target 0.85] [--min 30] [--json]

Reads review_log on the project in SUPABASE_URL with SUPABASE_SERVICE_ROLE_KEY
(read-only) and prints how often each quiz step and format is answered right,
and where each LADDER_THRESHOLDS value should be. --since defaults to 30 days
ago; --min is the fewest answers a threshold needs (from at least 5 learners,
each counted for at most 50).`;

/** The script's arguments, or what is wrong with them. */
export function parseReportArgs(argv: readonly string[], now: Date = new Date()): ReportArgs | { error: string } | { help: true } {
  const args: ReportArgs = {
    since: new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10),
    target: 0.85,
    minAnswers: 30,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--help" || flag === "-h") return { help: true };
    if (flag === "--json") {
      args.json = true;
      continue;
    }
    if (flag === "--since") {
      if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
        return { error: "--since takes a date, YYYY-MM-DD" };
      }
      args.since = value;
    } else if (flag === "--target") {
      const target = Number(value);
      if (!(target > 0 && target < 1)) return { error: "--target takes a share between 0 and 1, such as 0.85" };
      args.target = target;
    } else if (flag === "--min") {
      const min = Number(value);
      if (!Number.isInteger(min) || min < 1) return { error: "--min takes a whole number of answers" };
      args.minAnswers = min;
    } else {
      return { error: `unknown argument ${flag}` };
    }
    i++;
  }
  return args;
}
