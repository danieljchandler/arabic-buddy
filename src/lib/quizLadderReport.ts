import { LADDER_THRESHOLDS, rungForMemory, type QuizDirection } from "@/lib/quizLadder";

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
 * the card was asked from (stability before, and repetitions before, which the
 * log keeps as `repetitions_after - 1`, as the climbs count does):
 *
 * - on the ladder: asked at that step, in that step's own format. Only these
 *   set a threshold.
 * - a fallback: asked at that step in another format, for want of material
 *   (no picture, no recording, no device that records).
 * - off the ladder: asked at another step. A boss is (a first look whatever
 *   its stability); so is every row logged under thresholds since changed.
 *
 * What it cannot say: whether a threshold could come down. The ladder never
 * asks a step's question below its threshold, so the log has no answers
 * there; a threshold the step clears from its first band is reported as
 * holding, and lowering it would take an experiment that asks below it.
 */

/** One logged curriculum review, as the report reads it. */
export interface LoggedQuizAnswer {
  direction: QuizDirection;
  rating: string | null;
  quiz_format: string | null;
  quiz_step: number | null;
  stability_before: number | null;
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

export type ThresholdVerdict = "hold" | "raise" | "too-few" | "never-settles";

export interface ThresholdReport {
  name: keyof typeof LADDER_THRESHOLDS;
  direction: QuizDirection;
  /** The step this threshold opens. */
  step: number;
  current: number;
  /** On-ladder answers at that step. */
  answers: number;
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
  /** Rows read. */
  rows: number;
  /** Rows with no question recorded (flip cards, or logged before the columns) or no rating. */
  unrecorded: number;
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
  /** Fewest answers for a band to count against settling. */
  minBandAnswers?: number;
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

/** One more answer under a key: [answers, right]. */
function count<K>(map: Map<K, [number, number]>, key: K, right: boolean): void {
  const [answers, rightCount] = map.get(key) ?? [0, 0];
  map.set(key, [answers + 1, rightCount + (right ? 1 : 0)]);
}

function tally(answers: number, right: number): Tally {
  return { answers, right, accuracy: answers > 0 ? right / answers : null };
}

/** The memory a review was asked from, as the log keeps it. */
function memoryBefore(row: LoggedQuizAnswer) {
  const first = row.stability_before == null;
  return {
    stability: row.stability_before ?? 0,
    repetitions: first ? 0 : Math.max((row.repetitions_after ?? 0) - 1, 0),
  };
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

  const steps = new Map<number, [number, number]>();
  const formats = new Map<string, [number, number]>();
  const onLadder: Array<{ row: LoggedQuizAnswer; stability: number; right: boolean }> = [];
  let unrecorded = 0;
  let fallback = 0;
  let offLadder = 0;

  for (const row of rows) {
    if (row.quiz_step == null || !row.quiz_format || !row.rating) {
      unrecorded++;
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
    const at = onLadder.filter((a) => a.row.direction === boundary.direction && a.row.quiz_step === boundary.step);
    const bands = bandEdges(current, nextThreshold(index)).map((edge) => {
      const inBand = at.filter((a) => a.stability >= edge.from && (edge.to == null || a.stability < edge.to));
      return { ...edge, ...tally(inBand.length, inBand.filter((a) => a.right).length) };
    });

    let settlesAt: number | null = null;
    for (let i = 0; i < bands.length; i++) {
      const above = bands.slice(i);
      const pooled = above.reduce((sum, band) => ({ answers: sum.answers + band.answers, right: sum.right + band.right }), {
        answers: 0,
        right: 0,
      });
      const holds =
        pooled.answers >= minAnswers &&
        pooled.right / pooled.answers >= target &&
        above.every((band) => band.answers < minBandAnswers || (band.accuracy ?? 0) >= target);
      if (holds) {
        settlesAt = bands[i].from;
        break;
      }
    }

    const verdict: ThresholdVerdict =
      at.length < minAnswers ? "too-few" : settlesAt == null ? "never-settles" : settlesAt > current ? "raise" : "hold";
    return {
      ...boundary,
      current,
      answers: at.length,
      bands,
      settlesAt: verdict === "too-few" ? null : settlesAt,
      proposed: verdict === "hold" ? current : verdict === "raise" ? round(settlesAt!) : null,
      verdict,
    };
  });

  return {
    target,
    minAnswers,
    rows: rows.length,
    unrecorded,
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
    `Quiz ladder report: ${report.rows} reviews read; ${report.onLadder} on the ladder, ${report.fallback} fallbacks, ` +
      `${report.offLadder} off it (a boss, or older thresholds), ${report.unrecorded} with no question recorded.`,
    `Target: ${Math.round(report.target * 100)}% right; a threshold needs ${report.minAnswers} answers to say anything.`,
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
        ? `too few answers (${t.answers})`
        : t.verdict === "never-settles"
          ? `never reaches the target above ${t.current} days`
          : t.verdict === "hold"
            ? `holds at ${t.current} days (lowering it needs answers below it, which the ladder never asks)`
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

export type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

/**
 * Every curriculum review with a question recorded since a day, a page at a
 * time, with the service role (review_log is readable only by its owner
 * otherwise). Read-only.
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
  for (let offset = 0; ; offset += pageSize) {
    const query = new URLSearchParams({
      select: "direction,rating,quiz_format,quiz_step,stability_before,repetitions_after",
      deck: "eq.word",
      quiz_step: "not.is.null",
      reviewed_at: `gte.${ctx.since}`,
      order: "id",
      limit: String(pageSize),
      offset: String(offset),
    });
    const response = await ctx.fetch(`${ctx.supabaseUrl}/rest/v1/review_log?${query}`, {
      headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` },
    });
    if (!response.ok) throw new Error(`review_log read failed (${response.status}): ${await response.text()}`);
    const page = (await response.json()) as Array<Record<string, unknown>>;
    for (const raw of page) {
      rows.push({
        direction: raw.direction === "production" ? "production" : "recognition",
        rating: typeof raw.rating === "string" ? raw.rating : null,
        quiz_format: typeof raw.quiz_format === "string" ? raw.quiz_format : null,
        quiz_step: raw.quiz_step == null ? null : Number(raw.quiz_step),
        stability_before: raw.stability_before == null ? null : Number(raw.stability_before),
        repetitions_after: raw.repetitions_after == null ? null : Number(raw.repetitions_after),
      });
    }
    if (page.length < pageSize) return rows;
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
and where each LADDER_THRESHOLDS value should be. --since defaults to 30 days ago.`;

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
