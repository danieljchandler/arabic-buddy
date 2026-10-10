/**
 * The deciding half of `scripts/curriculum-animations.ts` (quiz Phase 5,
 * "animations for action words").
 *
 * For every curriculum word that qualifies (`qualifiesForAnimation`: a verb by
 * its category, or an action noun, whose gloss keys an action), make sure the
 * shared store holds a clip of its action. A clip is keyed on the English
 * action alone, so the run works per action, not per word: Gulf's آكل,
 * Egyptian's باكل and Yemeni's آكل are one "eat", made once. Nothing is
 * written onto `vocabulary_words` — the quiz reads a clip from the store by
 * the word's gloss, as it reads a learner word's picture — so a run only asks
 * `word-asset` for what is missing.
 *
 * It asks on the function's trusted path (the service-role key), which is the
 * only path that makes a clip at all: a learner's ask is refused. Nothing is
 * charged to anyone; the project's provider keys pay, a poster and four
 * seconds of Veo per clip, and the dry run prints that bill.
 *
 * Everything here takes `fetch` as a parameter, so the Vitest suite drives it
 * against a stubbed project (`src/test/curriculumAnimations.test.ts`). Nothing
 * in the repo's tests or CI reaches a real project or a real model.
 *
 * What it must get right, each with a test:
 *
 * - `--dry-run` only reads: it calls no function and writes nothing, and it
 *   prints how many clips a real run would make and what they would cost.
 * - One clip per action, however many words share it, and none for an action
 *   already in the store.
 * - A clip still rendering when the function answers (`202 pending`) is
 *   looked up with `get` until it is filed, so a slow render is neither lost
 *   nor paid for twice by the next word.
 * - It stops when the answer says every later clip would fail the same way:
 *   the key refused, the function not deployed or not this version, the
 *   store's table or the bucket not on the project, no provider.
 */
import { IMAGE_MODEL_IDS, IMAGE_PRICE_USD, VIDEO_MODEL_IDS, VIDEO_PRICE_USD_PER_SECOND } from "../supabase/functions/_shared/modelRegistry.ts";
import { ANIMATION_SECONDS, qualifiesForAnimation } from "../supabase/functions/_shared/wordAnimation.ts";
import { ASSET_BUCKETS, assetKey, type AssetKey } from "../supabase/functions/_shared/wordAssets.ts";
import {
  headers,
  readJson,
  restGet,
  stageLessonFilter,
  type PictureOptions,
  type RestError,
  type RunContext,
} from "./curriculum-pictures-core.ts";

export { parseArgs, projectFromEnv } from "./curriculum-pictures-core.ts";

/** The same four flags as the pictures script; `--limit` counts clips, not words. */
export type AnimationOptions = PictureOptions;

export const USAGE = [
  "Usage: deno run --allow-env --allow-read --allow-net scripts/curriculum-animations.ts",
  "         [--dialect Gulf|Egyptian|Yemeni] [--stage 1|2|3] [--limit N] [--dry-run]",
  "",
  "  --dialect  only this dialect's words",
  "  --stage    only the words of this stage's lessons",
  "  --limit    at most N clips (one per action, however many words share it)",
  "  --dry-run  list the actions, and what the clips would cost; makes and writes nothing",
  "",
  "Needs SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_URL unless supabase/config.toml names the project.",
].join("\n");

/** Rows per page when listing. PostgREST caps a page at 1000 by default. */
const PAGE_SIZE = 500;

/**
 * How long one ask may take before it is given up on. Longer than the
 * function holds a caller (`ANIMATION_ANSWER_MS`, 100 s) by enough for the
 * poster and the uploads: past that it answers `pending` rather than staying.
 */
export const CALL_TIMEOUT_MS = 180_000;

/** Between looks for a clip still rendering. */
export const PENDING_POLL_MS = 15_000;

/**
 * How long a clip still rendering is waited for. The function gives one clip
 * 300 s from the start of its render; past this it either failed or is filed
 * and the next run finds it for nothing.
 */
export const PENDING_WAIT_MS = 360_000;

/** Failures in a row after which the run stops: something is down. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** A breath between renders, so a long run does not trip a rate limit. */
export const PAUSE_BETWEEN_CLIPS_MS = 2_000;

// ── What a clip costs ───────────────────────────────────────────────────────

/** One clip's price on each route: the poster, then `ANIMATION_SECONDS` of video. */
export function clipCostUsd(): { vendor: number; openrouter: number } {
  const poster = IMAGE_PRICE_USD[IMAGE_MODEL_IDS.GEMINI] ?? 0;
  const perSecond = VIDEO_PRICE_USD_PER_SECOND[VIDEO_MODEL_IDS.VEO_LITE];
  return {
    vendor: poster + ANIMATION_SECONDS * perSecond.vendor,
    openrouter: poster + ANIMATION_SECONDS * perSecond.openrouter,
  };
}

const usd = (n: number) => `$${n.toFixed(2)}`;

// ── The curriculum ──────────────────────────────────────────────────────────

export interface AnimationWordRow {
  id: string;
  word_arabic: string;
  word_english: string;
  category: string | null;
  dialect_module: string | null;
  lesson_id: string | null;
  display_order: number | null;
}

/**
 * Every curriculum word in the filters, in a fixed order (dialect, lesson, the
 * word's place in it), so `--limit` takes the same actions on every run.
 */
export async function listCurriculumWords(
  ctx: RunContext,
  options: Pick<AnimationOptions, "dialect" | "stage">,
): Promise<AnimationWordRow[]> {
  const lessonFilter = await stageLessonFilter(ctx, options);
  if (lessonFilter === null) return [];
  const base =
    "select=id,word_arabic,word_english,category,dialect_module,lesson_id,display_order" +
    (options.dialect ? `&dialect_module=eq.${options.dialect}` : "") +
    lessonFilter +
    "&order=dialect_module.asc,lesson_id.asc.nullslast,display_order.asc,id.asc";

  const rows: AnimationWordRow[] = [];
  const seen = new Set<string>();
  for (;;) {
    const page = await restGet<AnimationWordRow>(ctx, "vocabulary_words", `${base}&limit=${PAGE_SIZE}&offset=${rows.length}`);
    const fresh = page.filter((row) => !seen.has(row.id));
    if (fresh.length === 0) break;
    for (const row of fresh) seen.add(row.id);
    rows.push(...fresh);
  }
  return rows;
}

/** One action to have a clip of, and the words that share it. */
export interface ActionPlan {
  key: AssetKey;
  /** The first word that asks for it: its gloss is what is sent. */
  row: AnimationWordRow;
  /** Every word in the filters that will be shown it. */
  words: AnimationWordRow[];
}

/** The qualifying words, one plan per action, in the order the words came. */
export function planActions(rows: readonly AnimationWordRow[]): { actions: ActionPlan[]; notActions: number } {
  const byKey = new Map<string, ActionPlan>();
  let notActions = 0;
  for (const row of rows) {
    const gloss = (row.word_english ?? "").trim();
    const key = qualifiesForAnimation({ category: row.category, gloss })
      ? assetKey({ kind: "animation", word: row.word_arabic, gloss })
      : null;
    if (!key) {
      notActions++;
      continue;
    }
    const plan = byKey.get(key.conceptKey);
    if (plan) plan.words.push(row);
    else byKey.set(key.conceptKey, { key, row, words: [row] });
  }
  return { actions: [...byKey.values()], notActions };
}

const label = (plan: ActionPlan) => {
  const words = [...new Set(plan.words.map((w) => `${w.word_arabic} (${w.dialect_module ?? "?"})`))];
  return `"${plan.key.conceptKey}"  ${words.slice(0, 4).join(", ")}${words.length > 4 ? ` +${words.length - 4}` : ""}`;
};

// ── The store and the bucket, read only ─────────────────────────────────────

export type ClipState = { state: "have"; url: string } | { state: "missing" } | { state: "no-table" };

/** Whether the store holds a clip of an action. Read-only. */
export async function lookUpClip(ctx: RunContext, key: AssetKey): Promise<ClipState> {
  const query =
    "select=id,url" +
    `&concept_key=eq.${encodeURIComponent(key.conceptKey)}` +
    `&kind=eq.animation&style_version=eq.${encodeURIComponent(key.styleVersion)}` +
    "&dialect=is.null&limit=1";
  const response = await ctx.fetch(`${ctx.supabaseUrl}/rest/v1/word_assets?${query}`, { headers: headers(ctx) });
  const body = await readJson(response);
  if (!response.ok) {
    const error = (body ?? {}) as RestError;
    const missing =
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      (response.status === 404 && /word_assets/.test(error.message ?? ""));
    if (missing) return { state: "no-table" };
    throw new Error(`could not read word_assets: ${error.message ?? `HTTP ${response.status}`}`);
  }
  const row = Array.isArray(body) ? (body[0] as Record<string, unknown> | undefined) : undefined;
  return row && typeof row.url === "string" && row.url ? { state: "have", url: row.url } : { state: "missing" };
}

/** Whether the animations bucket exists on the project. Read-only. */
export async function bucketExists(ctx: RunContext): Promise<boolean> {
  const response = await ctx.fetch(`${ctx.supabaseUrl}/storage/v1/bucket/${ASSET_BUCKETS.animation}`, {
    headers: headers(ctx),
  });
  return response.ok;
}

// ── One action ──────────────────────────────────────────────────────────────

export type ClipResult =
  | { ok: true; url: string; how: "made" | "found"; stored: boolean }
  /** This action only; the run goes on. */
  | { ok: false; fatal: false; skip: boolean; reason: string }
  /** Every later clip would fail the same way; the run stops. */
  | { ok: false; fatal: true; reason: string };

async function callWordAsset(
  ctx: RunContext,
  action: "get" | "ensure",
  plan: ActionPlan,
): Promise<{ response: Response; body: Record<string, unknown> } | { error: string }> {
  try {
    const response = await ctx.fetch(`${ctx.supabaseUrl}/functions/v1/word-asset`, {
      method: "POST",
      headers: headers(ctx),
      body: JSON.stringify({
        action,
        kind: "animation",
        word: plan.row.word_arabic,
        gloss: plan.row.word_english.trim(),
      }),
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(CALL_TIMEOUT_MS) : undefined,
    });
    return { response, body: ((await readJson(response)) ?? {}) as Record<string, unknown> };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Ask `word-asset` for the clip, on its trusted path, and wait out a slow render. */
export async function ensureClip(ctx: RunContext, plan: ActionPlan): Promise<ClipResult> {
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const asked = await callWordAsset(ctx, "ensure", plan);
  if ("error" in asked) return { ok: false, fatal: false, skip: false, reason: asked.error };
  const { response, body } = asked;
  const said = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "";

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      fatal: true,
      reason:
        "word-asset refused the key. Only the Phase 5 function makes clips, and only for the service role: check " +
        `that it is deployed and that SUPABASE_SERVICE_ROLE_KEY is this project's${said ? ` (${said})` : ""}.`,
    };
  }
  if (response.status === 404) return { ok: false, fatal: true, reason: "word-asset is not deployed on this project." };
  if (response.status === 400 && body.error === "kind_not_generated") {
    return { ok: false, fatal: true, reason: "the deployed word-asset makes no animations: deploy the Phase 5 function." };
  }
  if (response.status === 400) return { ok: false, fatal: false, skip: true, reason: said || "word-asset turned it away" };
  if (response.status === 503) {
    const why = body.error === "store_not_ready"
      ? "word_assets is not on this project (Phase 2b), and a clip is never made that cannot be kept"
      : body.error === "bucket_not_ready"
      ? "the word-animations bucket is not on this project (its migration, 20261009140000_word_animations_bucket)"
      : `word-asset has no provider configured${said ? ` (${said})` : ""}`;
    return { ok: false, fatal: true, reason: `${why}.` };
  }
  if (!response.ok) return { ok: false, fatal: false, skip: false, reason: said || `HTTP ${response.status}` };

  if (body.pending === true) {
    // Still rendering behind the answer: look it up until it is filed. Asking
    // `ensure` again instead would start, and pay for, a second render.
    for (let waited = 0; waited < PENDING_WAIT_MS; waited += PENDING_POLL_MS) {
      await sleep(PENDING_POLL_MS);
      const looked = await callWordAsset(ctx, "get", plan);
      if ("error" in looked) continue;
      const url = typeof looked.body.url === "string" ? looked.body.url : "";
      if (url) return { ok: true, url, how: "made", stored: true };
    }
    return {
      ok: false,
      fatal: false,
      skip: false,
      reason: "still not filed after six minutes; the next run finds it if it was, and makes it if it failed",
    };
  }

  const url = typeof body.url === "string" ? body.url : "";
  if (!url) return { ok: false, fatal: false, skip: false, reason: said || "no clip came back" };
  return { ok: true, url, how: body.cached === true ? "found" : "made", stored: body.stored === true };
}

// ── The run ─────────────────────────────────────────────────────────────────

export interface AnimationSummary {
  dryRun: boolean;
  /** Curriculum words in the filters. */
  words: number;
  /** Of those, the words whose gloss and category make them no action. */
  notActions: number;
  /** Distinct actions among the rest. */
  actions: number;
  /** Actions already in the store. */
  have: number;
  /** Clips made (a dry run: to make). */
  made: number;
  /** Clips made but not kept in the store. */
  unfiled: number;
  /** Actions left for another run by `--limit`. */
  beyondLimit: number;
  /** Actions the function turned away. */
  skipped: Array<{ action: string; reason: string }>;
  /** Actions that failed and are worth another run. */
  failed: Array<{ action: string; reason: string }>;
  /** Why the run stopped early, or (a dry run) why a real run would stop at once. */
  stopped: string | null;
}

/**
 * List, plan, and either report (`dryRun`) or ask. Throws only when the
 * curriculum cannot be listed, before anything is spent.
 */
export async function runAnimations(ctx: RunContext, options: AnimationOptions): Promise<AnimationSummary> {
  const log = ctx.log ?? (() => {});
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const rows = await listCurriculumWords(ctx, options);
  const { actions, notActions } = planActions(rows);
  const summary: AnimationSummary = {
    dryRun: options.dryRun,
    words: rows.length,
    notActions,
    actions: actions.length,
    have: 0,
    made: 0,
    unfiled: 0,
    beyondLimit: 0,
    skipped: [],
    failed: [],
    stopped: null,
  };

  // What the store already holds costs nothing and is not counted against
  // --limit: the limit is the number of clips this run may pay for.
  const todo: ActionPlan[] = [];
  let storeMissing = false;
  for (const plan of actions) {
    // With no table every action is missing; asking again would say the same.
    const state: ClipState = storeMissing ? { state: "missing" } : await lookUpClip(ctx, plan.key);
    if (state.state === "no-table") {
      storeMissing = true;
      summary.stopped =
        "word_assets is not on this project yet (Phase 2b, the migration 20261009130000_word_assets). " +
        "A clip is never made that cannot be kept, so nothing would be made until it is.";
      log(`stop   ${summary.stopped}`);
      // A real run spends nothing; a dry run still counts what it would make.
      if (!options.dryRun) return summary;
    }
    if (state.state === "have") {
      summary.have++;
      log(`have   ${label(plan)}`);
      continue;
    }
    if (options.limit !== null && todo.length >= options.limit) {
      summary.beyondLimit++;
      continue;
    }
    todo.push(plan);
  }

  if (todo.length > 0 && !(await bucketExists(ctx))) {
    const bucket =
      "the word-animations bucket is not on this project yet (the migration " +
      "20261009140000_word_animations_bucket). Nothing would be made until it is.";
    summary.stopped = summary.stopped ? `${summary.stopped} And ${bucket}` : bucket;
    log(`stop   ${bucket}`);
    if (!options.dryRun) return summary;
  }

  if (options.dryRun) {
    for (const plan of todo) {
      summary.made++;
      log(`make   ${label(plan)}`);
    }
    return summary;
  }

  let consecutiveFailures = 0;
  for (const [index, plan] of todo.entries()) {
    const result = await ensureClip(ctx, plan);
    if (!result.ok) {
      if (result.fatal) {
        summary.stopped = result.reason;
        log(`stop   ${label(plan)}: ${result.reason}`);
        break;
      }
      if (result.skip) {
        summary.skipped.push({ action: plan.key.conceptKey, reason: result.reason });
        log(`skip   ${label(plan)}: ${result.reason}`);
        continue;
      }
      summary.failed.push({ action: plan.key.conceptKey, reason: result.reason });
      log(`fail   ${label(plan)}: ${result.reason}`);
      if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        summary.stopped = `${MAX_CONSECUTIVE_FAILURES} clips failed in a row; the last said: ${result.reason}`;
        log(`stop   ${summary.stopped}`);
        break;
      }
      continue;
    }
    consecutiveFailures = 0;
    if (result.how === "found") {
      summary.have++;
      log(`have   ${label(plan)}`);
      continue;
    }
    summary.made++;
    if (!result.stored) summary.unfiled++;
    log(`made   ${label(plan)}${result.stored ? "" : " (not kept in the store)"}`);
    if (index < todo.length - 1) await sleep(PAUSE_BETWEEN_CLIPS_MS);
  }
  return summary;
}

/** The run in a few lines, for the end of the output; a dry run's carries the bill. */
export function formatAnimationSummary(summary: AnimationSummary): string[] {
  const cost = clipCostUsd();
  const lines = [
    `${summary.words} curriculum word${summary.words === 1 ? "" : "s"}: ` +
      `${summary.words - summary.notActions} name an action, ${summary.actions} distinct action${summary.actions === 1 ? "" : "s"}.`,
    `  ${summary.have} already have a clip.`,
  ];
  if (summary.dryRun) {
    lines.push(
      `  ${summary.made} clip${summary.made === 1 ? "" : "s"} to make: ${summary.made} × ${usd(cost.vendor)} ` +
        `(a poster and ${ANIMATION_SECONDS} s of Veo 3.1 Lite on Google's API) = ${usd(summary.made * cost.vendor)}, ` +
        `or ${usd(summary.made * cost.openrouter)} where a clip falls back to OpenRouter.`,
      "  Nothing was made or written.",
    );
  } else {
    lines.push(`  ${summary.made} clip${summary.made === 1 ? "" : "s"} made, about ${usd(summary.made * cost.vendor)}.`);
    if (summary.unfiled) lines.push(`  ${summary.unfiled} made but not kept in the store.`);
  }
  if (summary.beyondLimit) lines.push(`  ${summary.beyondLimit} more left for another run (--limit).`);
  if (summary.skipped.length) lines.push(`  ${summary.skipped.length} turned away by word-asset (listed above).`);
  if (summary.failed.length) lines.push(`  ${summary.failed.length} failed; run again to retry them.`);
  if (summary.stopped) lines.push(`${summary.dryRun ? "A real run would stop" : "Stopped early"}: ${summary.stopped}`);
  return lines;
}

/** Whether the run should exit non-zero: it stopped early, or a clip failed. */
export function animationRunFailed(summary: AnimationSummary): boolean {
  return summary.stopped !== null || summary.failed.length > 0;
}
