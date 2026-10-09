/**
 * The deciding half of `scripts/curriculum-pictures.ts` (quiz Phase 3, "a
 * picture for every word").
 *
 * For every `vocabulary_words` row with no `image_url`, get the word's picture
 * through the shared asset store and write its url onto the row. The picture
 * is asked of the `word-asset` function with the service-role key, which is
 * the function's trusted path: the row's authored `image_scene_description`
 * (the track word's `image_scene`, written there by the curriculum seed) goes
 * along as `scene`, nothing is charged to anyone, and an authored picture
 * takes the place of one a learner's miss drew from the gloss alone.
 *
 * Everything here takes `fetch` as a parameter, so the Vitest suite drives it
 * against a stubbed project (`src/test/curriculumPictures.test.ts`); the
 * runner only reads the environment and prints. Nothing in the repo's tests
 * or CI reaches a real project or a real image model.
 *
 * What it must get right, each with a test:
 *
 * - `--dry-run` only reads. It calls no function and writes no row.
 * - The key is built by `assetKey`, the same module the function files under,
 *   so the script can say before spending anything which words the store
 *   would turn away.
 * - The url is written onto the row even when the store kept nothing
 *   (`stored: false`): until the `word_assets` migration reaches the live
 *   project every picture is drawn and none is filed, and the curriculum
 *   must still get its pictures.
 * - A row someone gave a picture while the script was running is left alone.
 * - It stops instead of grinding on when the answer says every later call
 *   will fail the same way: the key refused, the function not deployed, the
 *   deployed function ignoring the scene, no provider configured.
 */
import {
  assetKey,
  authoredScene,
  isReplaceable,
  type AssetDialect,
  type AssetKey,
  type WordAsset,
} from "../supabase/functions/_shared/wordAssets.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const PICTURE_DIALECTS: readonly AssetDialect[] = ["Gulf", "Egyptian", "Yemeni"];

/** The longest gloss `word-asset` takes (`MAX_GLOSS_LENGTH` there). */
const MAX_GLOSS_LENGTH = 80;

/** Rows per page when listing. PostgREST caps a page at 1000 by default. */
const PAGE_SIZE = 500;

/**
 * How long one picture may take before the call is given up on. Longer than
 * the function can: it asks the model twice, ninety seconds each at most,
 * and then uploads. A call abandoned while the function was still drawing
 * would be a picture paid for and written nowhere.
 */
export const CALL_TIMEOUT_MS = 240_000;

/** Failures in a row after which the run stops: something is down. */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** A breath between generations, so a long run does not trip a rate limit. */
export const PAUSE_BETWEEN_DRAWINGS_MS = 500;

// ── Arguments ────────────────────────────────────────────────────────────────

export interface PictureOptions {
  /** Only this dialect's words. */
  dialect: AssetDialect | null;
  /** Only the words of this stage's lessons (`curriculum_stages.stage_number`). */
  stage: number | null;
  /** At most this many words asked for. */
  limit: number | null;
  /** List what would be done; call no function and write no row. */
  dryRun: boolean;
}

export const USAGE = [
  "Usage: deno run --allow-env --allow-read --allow-net scripts/curriculum-pictures.ts",
  "         [--dialect Gulf|Egyptian|Yemeni] [--stage 1|2|3] [--limit N] [--dry-run]",
  "",
  "  --dialect  only this dialect's words",
  "  --stage    only the words of this stage's lessons",
  "  --limit    at most N words",
  "  --dry-run  list what would be done; draws nothing and writes nothing",
  "",
  "Needs SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_URL unless supabase/config.toml names the project.",
].join("\n");

export type ParsedArgs = { options: PictureOptions } | { help: true } | { error: string };

function matchDialect(value: string): AssetDialect | null {
  return PICTURE_DIALECTS.find((d) => d.toLowerCase() === value.trim().toLowerCase()) ?? null;
}

/** A whole number of at least one, or null. `"3abc"`, `"0"` and `"1.5"` are not. */
function positiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/**
 * The four flags, in `--flag value` or `--flag=value` form. Anything else is
 * an error rather than ignored: a mistyped `--dryrun` must not become a real
 * run that draws eight hundred pictures.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: PictureOptions = { dialect: null, stage: null, limit: null, dryRun: false };
  const args = [...argv];
  while (args.length > 0) {
    const raw = args.shift()!;
    const eq = raw.indexOf("=");
    const flag = eq > 0 ? raw.slice(0, eq) : raw;
    const inline = eq > 0 ? raw.slice(eq + 1) : undefined;
    const value = () => inline ?? (args[0]?.startsWith("--") ? undefined : args.shift());

    switch (flag) {
      case "--help":
      case "-h":
        return { help: true };
      case "--dry-run":
        if (inline !== undefined) return { error: "--dry-run takes no value" };
        options.dryRun = true;
        break;
      case "--dialect": {
        const given = value();
        const dialect = given ? matchDialect(given) : null;
        if (!dialect) return { error: `--dialect must be one of ${PICTURE_DIALECTS.join(", ")}` };
        options.dialect = dialect;
        break;
      }
      case "--stage": {
        const stage = positiveInteger(value());
        if (stage === null) return { error: "--stage must be a stage number, such as 1" };
        options.stage = stage;
        break;
      }
      case "--limit": {
        const limit = positiveInteger(value());
        if (limit === null) return { error: "--limit must be a whole number of at least 1" };
        options.limit = limit;
        break;
      }
      default:
        return { error: `unknown argument: ${raw}` };
    }
  }
  return { options };
}

// ── Configuration ────────────────────────────────────────────────────────────

export type Env = Record<string, string | undefined>;

/** `https://<project_id>.supabase.co`, from supabase/config.toml's project_id. */
export function supabaseUrlFromConfig(configToml: string): string | null {
  const match = /^project_id\s*=\s*"([^"]+)"/m.exec(configToml);
  return match ? `https://${match[1]}.supabase.co` : null;
}

export interface Project {
  supabaseUrl: string;
  serviceRoleKey: string;
}

export function projectFromEnv(env: Env, configToml: string | null): Project | { error: string } {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const supabaseUrl = (env.SUPABASE_URL?.trim() || (configToml ? supabaseUrlFromConfig(configToml) : null) || "")
    .replace(/\/+$/, "");
  const missing = [
    ...(serviceRoleKey ? [] : ["SUPABASE_SERVICE_ROLE_KEY"]),
    ...(supabaseUrl ? [] : ["SUPABASE_URL (or a project_id in supabase/config.toml)"]),
  ];
  if (missing.length > 0) return { error: `not configured: missing ${missing.join(" and ")}` };
  // https, or a local stack (`supabase start`). The key is sent to this host.
  if (!/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$)/.test(supabaseUrl)) {
    return { error: `SUPABASE_URL must be an https url (or a local stack), got ${supabaseUrl}` };
  }
  return { supabaseUrl, serviceRoleKey: serviceRoleKey! };
}

// ── The project, over plain fetch ────────────────────────────────────────────

export interface RunContext extends Project {
  fetch: FetchLike;
  /** Waits; a test passes one that does not. */
  sleep?: (ms: number) => Promise<void>;
  /** A line of progress. */
  log?: (line: string) => void;
}

function headers(ctx: Project, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: ctx.serviceRoleKey,
    Authorization: `Bearer ${ctx.serviceRoleKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

interface RestError {
  code?: string;
  message?: string;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** One page of a table. Throws on anything but rows: listing is all or nothing. */
async function restGet<T>(ctx: RunContext, table: string, query: string): Promise<T[]> {
  const response = await ctx.fetch(`${ctx.supabaseUrl}/rest/v1/${table}?${query}`, { headers: headers(ctx) });
  const body = await readJson(response);
  if (!response.ok || !Array.isArray(body)) {
    const message = (body as RestError | null)?.message ?? `HTTP ${response.status}`;
    throw new Error(`could not read ${table}: ${message}`);
  }
  return body as T[];
}

/** A PostgREST `in.(...)` list of plain ids. */
const inList = (ids: readonly string[]) => `in.(${ids.map((id) => encodeURIComponent(id)).join(",")})`;

export interface WordRow {
  id: string;
  word_arabic: string;
  word_english: string;
  dialect_module: string | null;
  image_scene_description: string | null;
  lesson_id: string | null;
  display_order: number | null;
}

/**
 * Every curriculum word with no picture, in a fixed order (dialect, lesson,
 * the word's place in it), so `--limit` is the same slice on every run.
 * An empty string counts as no picture: the admin form clears to one.
 *
 * Listed whole before anything is written, so the pages do not shift under
 * the offset as rows are filled.
 */
export async function listWordsWithoutPicture(
  ctx: RunContext,
  options: Pick<PictureOptions, "dialect" | "stage">,
): Promise<WordRow[]> {
  let lessonFilter = "";
  if (options.stage !== null) {
    const stages = await restGet<{ id: string }>(
      ctx,
      "curriculum_stages",
      `select=id&stage_number=eq.${options.stage}`,
    );
    if (stages.length === 0) return [];
    const lessons = await restGet<{ id: string }>(
      ctx,
      "lessons",
      `select=id&stage_id=${inList(stages.map((s) => s.id))}` +
        (options.dialect ? `&dialect_module=eq.${options.dialect}` : "") +
        "&limit=1000",
    );
    if (lessons.length === 0) return [];
    lessonFilter = `&lesson_id=${inList(lessons.map((l) => l.id))}`;
  }

  const base =
    "select=id,word_arabic,word_english,dialect_module,image_scene_description,lesson_id,display_order" +
    "&or=(image_url.is.null,image_url.eq.)" +
    (options.dialect ? `&dialect_module=eq.${options.dialect}` : "") +
    lessonFilter +
    "&order=dialect_module.asc,lesson_id.asc.nullslast,display_order.asc,id.asc";

  // Until a page comes back empty, stepping by what was returned: a project
  // whose `max_rows` is under PAGE_SIZE answers short pages that are not the
  // last, and stopping at the first short one would quietly skip the rest.
  const rows: WordRow[] = [];
  const seen = new Set<string>();
  for (;;) {
    const page = await restGet<WordRow>(ctx, "vocabulary_words", `${base}&limit=${PAGE_SIZE}&offset=${rows.length}`);
    // A page with nothing new is the end too: whatever answered did not
    // honour the offset, and asking again would go round for ever.
    const fresh = page.filter((row) => !seen.has(row.id));
    if (fresh.length === 0) break;
    for (const row of fresh) seen.add(row.id);
    rows.push(...fresh);
  }
  return rows;
}

// ── One word ─────────────────────────────────────────────────────────────────

export type WordPlan =
  | { row: WordRow; key: AssetKey; scene: string | null }
  /** A word the store cannot file; `reason` is for the person reading the run. */
  | { row: WordRow; key: null; reason: string };

/** What to ask for a row, decided without the network. */
export function planWord(row: WordRow): WordPlan {
  const gloss = (row.word_english ?? "").trim();
  if (gloss.length > MAX_GLOSS_LENGTH) {
    return { row, key: null, reason: `its English is a note, not a sense (${gloss.length} characters)` };
  }
  const key = assetKey({ kind: "image", word: row.word_arabic, gloss, dialect: row.dialect_module });
  if (!key) {
    return {
      row,
      key: null,
      reason: "the store cannot file it (no Arabic, no English sense, or a Fusha row)",
    };
  }
  // By the function's own rule for what a scene is. A row whose scene is too
  // short to be one is drawn from its gloss, and is not then mistaken for a
  // deployment that ignored the scene.
  return { row, key, scene: authoredScene(row.image_scene_description) || null };
}

const label = (row: WordRow) => `${row.dialect_module ?? "?"}  ${row.word_arabic}  "${row.word_english}"`;

export type StoreState =
  /** Nothing filed: it would be drawn. */
  | { state: "miss" }
  /** Filed and kept: it would be copied onto the row, for nothing. */
  | { state: "hit"; asset: Pick<WordAsset, "url" | "source"> }
  /** Filed from the gloss alone: the authored scene would be drawn in its place. */
  | { state: "replaceable"; asset: Pick<WordAsset, "url" | "source"> }
  /** `word_assets` is not on this project yet (Phase 2b). */
  | { state: "no-table" };

/** What the store holds for a key, read straight from the table. Read-only. */
export async function lookUpStore(ctx: RunContext, plan: Extract<WordPlan, { key: AssetKey }>): Promise<StoreState> {
  const { key } = plan;
  const query =
    "select=id,url,source,approved_at" +
    `&concept_key=eq.${encodeURIComponent(key.conceptKey)}` +
    `&kind=eq.${key.kind}&style_version=eq.${encodeURIComponent(key.styleVersion)}` +
    (key.dialect === null ? "&dialect=is.null" : `&dialect=eq.${key.dialect}`) +
    "&limit=1";
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
  if (!row || typeof row.url !== "string" || !row.url) return { state: "miss" };
  const asset = {
    url: row.url,
    source: typeof row.source === "string" ? row.source : "generated",
    approvedAt: typeof row.approved_at === "string" ? row.approved_at : null,
  };
  // The function's own rule, so the dry run cannot promise what it will not do.
  const gives = plan.scene !== null && isReplaceable(asset);
  return { state: gives ? "replaceable" : "hit", asset: { url: asset.url, source: asset.source } };
}

export type EnsureResult =
  /** A picture: `how` says where it came from. */
  | { ok: true; url: string; how: "drawn" | "copied" | "replaced"; stored: boolean }
  /** This word only; the run goes on. */
  | { ok: false; fatal: false; skip: boolean; reason: string }
  /** Every later call would fail the same way; the run stops. */
  | { ok: false; fatal: true; reason: string };

/** Ask `word-asset` for the picture, on its trusted path. */
export async function ensurePicture(
  ctx: RunContext,
  plan: Extract<WordPlan, { key: AssetKey }>,
): Promise<EnsureResult> {
  const { row, scene } = plan;
  let response: Response;
  try {
    response = await ctx.fetch(`${ctx.supabaseUrl}/functions/v1/word-asset`, {
      method: "POST",
      headers: headers(ctx),
      body: JSON.stringify({
        action: "ensure",
        kind: "image",
        word: row.word_arabic,
        gloss: row.word_english.trim(),
        dialect: row.dialect_module ?? undefined,
        ...(scene ? { scene } : {}),
      }),
      // Not every runtime the tests run in has it; Deno, where this runs, does.
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(CALL_TIMEOUT_MS) : undefined,
    });
  } catch (err) {
    return { ok: false, fatal: false, skip: false, reason: err instanceof Error ? err.message : String(err) };
  }

  const body = ((await readJson(response)) ?? {}) as Record<string, unknown>;
  const said = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "";

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      fatal: true,
      reason:
        "word-asset refused the key. Only the Phase 3 function accepts the service-role key: check that it " +
        "is deployed, and that SUPABASE_SERVICE_ROLE_KEY is this project's service-role key.",
    };
  }
  if (response.status === 404) {
    return { ok: false, fatal: true, reason: "word-asset is not deployed on this project." };
  }
  if (response.status === 503 || body.error === "ai_unconfigured") {
    return { ok: false, fatal: true, reason: `word-asset has no image provider configured${said ? ` (${said})` : ""}.` };
  }
  if (response.status === 429) {
    // The trusted path is charged to nobody, so a daily cap here means the
    // call was not taken for a trusted one.
    return {
      ok: false,
      fatal: true,
      reason: `word-asset answered with a daily cap, which the service role is never charged${said ? ` (${said})` : ""}.`,
    };
  }
  if (response.status === 400) {
    return { ok: false, fatal: false, skip: true, reason: said || "word-asset turned the word away" };
  }
  if (!response.ok) {
    return { ok: false, fatal: false, skip: false, reason: said || `HTTP ${response.status}` };
  }

  const url = typeof body.url === "string" ? body.url : "";
  if (!url) {
    // The function's graceful shape for a model that drew nothing.
    return { ok: false, fatal: false, skip: false, reason: said || "no picture came back" };
  }
  const cached = body.cached === true;
  // A newly drawn picture must say it was drawn from the scene we sent. One
  // that does not came from a function that does not know the trusted path,
  // and every later word would be drawn from its gloss alone, at full price.
  if (scene && !cached && body.authored !== true) {
    return {
      ok: false,
      fatal: true,
      reason:
        "word-asset drew a picture without the authored scene. Deploy the Phase 3 function before running this; " +
        `the picture it returned for ${row.word_arabic} was not written to the row.`,
    };
  }
  return {
    ok: true,
    url,
    how: cached ? "copied" : body.replaced === true ? "replaced" : "drawn",
    stored: body.stored === true,
  };
}

/**
 * Put the url on the row, if the row still has no picture. False when
 * someone gave it one in the meantime; theirs stays.
 */
export async function writePicture(ctx: RunContext, row: WordRow, url: string): Promise<boolean> {
  const response = await ctx.fetch(
    `${ctx.supabaseUrl}/rest/v1/vocabulary_words?id=eq.${encodeURIComponent(row.id)}` +
      "&or=(image_url.is.null,image_url.eq.)&select=id",
    {
      method: "PATCH",
      headers: headers(ctx, { Prefer: "return=representation" }),
      body: JSON.stringify({ image_url: url }),
    },
  );
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`could not write the picture onto ${row.id}: ${(body as RestError | null)?.message ?? `HTTP ${response.status}`}`);
  }
  return Array.isArray(body) && body.length > 0;
}

// ── The run ──────────────────────────────────────────────────────────────────

export interface RunSummary {
  dryRun: boolean;
  /** Rows with no picture that matched the filters. */
  listed: number;
  /** Rows the store cannot file, with why. */
  unfileable: Array<{ id: string; word: string; reason: string }>;
  /** Rows left for another run by `--limit`. */
  beyondLimit: number;
  /** Pictures a model drew (a dry run: would draw). */
  drawn: number;
  /** Pictures already in the store, copied for nothing (a dry run: would copy). */
  copied: number;
  /** Gloss-only pictures an authored scene took the place of (a dry run: would). */
  replaced: number;
  /** Pictures drawn and written to the row but not kept in the store. */
  unfiled: number;
  /** Rows given their url. Always zero on a dry run. */
  written: number;
  /** Rows someone else gave a picture while the script ran. */
  alreadyFilled: number;
  /** Words the function turned away. */
  skipped: Array<{ id: string; word: string; reason: string }>;
  /** Words that failed and are worth another run. */
  failed: Array<{ id: string; word: string; reason: string }>;
  /** Why the run stopped early, when it did. */
  stopped: string | null;
  /** `word_assets` is not on the project: nothing drawn is being kept. */
  storeMissing: boolean;
}

export const STORE_MISSING_WARNING =
  "word_assets is not on this project yet (Phase 2b, the migration 20261009130000_word_assets). " +
  "Every picture is drawn and written onto its row, but none is kept in the store, so a learner " +
  "who saves the same word will not share it. Apply the migration first to keep what this draws.";

/**
 * List, plan, and either report (`dryRun`) or ask and write. Throws only
 * when the curriculum cannot be listed, before anything is spent; after
 * that every way of going wrong ends in a summary of what was done.
 */
export async function runPictures(ctx: RunContext, options: PictureOptions): Promise<RunSummary> {
  const log = ctx.log ?? (() => {});
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const rows = await listWordsWithoutPicture(ctx, options);
  const summary: RunSummary = {
    dryRun: options.dryRun,
    listed: rows.length,
    unfileable: [],
    beyondLimit: 0,
    drawn: 0,
    copied: 0,
    replaced: 0,
    unfiled: 0,
    written: 0,
    alreadyFilled: 0,
    skipped: [],
    failed: [],
    stopped: null,
    storeMissing: false,
  };

  const fileable: Array<Extract<WordPlan, { key: AssetKey }>> = [];
  for (const row of rows) {
    const plan = planWord(row);
    if (plan.key === null) {
      summary.unfileable.push({ id: row.id, word: label(row), reason: plan.reason });
      log(`skip   ${label(row)}: ${plan.reason}`);
    } else {
      fileable.push(plan);
    }
  }
  const todo = options.limit === null ? fileable : fileable.slice(0, options.limit);
  summary.beyondLimit = fileable.length - todo.length;

  // One look at the store before anything is spent: whether it is there at
  // all decides whether what is drawn is kept.
  const first = todo.length > 0 ? await lookUpStore(ctx, todo[0]) : null;
  if (first?.state === "no-table") {
    summary.storeMissing = true;
    log(`warning: ${STORE_MISSING_WARNING}`);
  }

  if (options.dryRun) {
    // Two rows with one key (the same word and sense in two lessons) are one
    // picture: the real run draws it for the first and copies it for the second.
    const planned = new Set<string>();
    for (const [index, plan] of todo.entries()) {
      const keyId = `${plan.key.dialect ?? ""}\n${plan.key.conceptKey}`;
      if (planned.has(keyId)) {
        summary.copied++;
        log(`copy   ${label(plan.row)}: the same word and sense as a row above`);
        continue;
      }
      planned.add(keyId);
      // With no table every word is a miss; asking again would say the same.
      const store: StoreState = summary.storeMissing
        ? { state: "miss" }
        : index === 0 && first
          ? first
          : await lookUpStore(ctx, plan);
      const scene = plan.scene ? `scene: ${plan.scene}` : "no authored scene, from the gloss alone";
      if (store.state === "hit") {
        summary.copied++;
        log(`copy   ${label(plan.row)}: already in the store (${store.asset.source})`);
      } else if (store.state === "replaceable") {
        summary.replaced++;
        log(`redraw ${label(plan.row)}: in place of a gloss-only picture; ${scene}`);
      } else {
        summary.drawn++;
        log(`draw   ${label(plan.row)}: ${scene}`);
      }
    }
    return summary;
  }

  let consecutiveFailures = 0;
  for (const [index, plan] of todo.entries()) {
    const result = await ensurePicture(ctx, plan);
    const word = label(plan.row);

    if (!result.ok) {
      if (result.fatal) {
        summary.stopped = result.reason;
        log(`stop   ${word}: ${result.reason}`);
        break;
      }
      if (result.skip) {
        summary.skipped.push({ id: plan.row.id, word, reason: result.reason });
        log(`skip   ${word}: ${result.reason}`);
        continue;
      }
      summary.failed.push({ id: plan.row.id, word, reason: result.reason });
      log(`fail   ${word}: ${result.reason}`);
      if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        summary.stopped = `${MAX_CONSECUTIVE_FAILURES} words failed in a row; the last said: ${result.reason}`;
        log(`stop   ${summary.stopped}`);
        break;
      }
      continue;
    }
    consecutiveFailures = 0;

    if (result.how === "copied") summary.copied++;
    else if (result.how === "replaced") summary.replaced++;
    else summary.drawn++;
    if (!result.stored) summary.unfiled++;

    let written: boolean;
    try {
      written = await writePicture(ctx, plan.row, result.url);
    } catch (err) {
      // The key cannot write the curriculum, or the database is away: the
      // next word would be drawn and lost the same way. Stop, and say where
      // the picture that was just made is.
      const reason = err instanceof Error ? err.message : String(err);
      summary.stopped = `${reason}. The picture drawn for it is at ${result.url}`;
      log(`stop   ${word}: ${summary.stopped}`);
      break;
    }
    if (written) {
      summary.written++;
      log(`${result.how.padEnd(6)} ${word}${result.stored ? "" : " (not kept in the store)"}`);
    } else {
      summary.alreadyFilled++;
      log(`kept   ${word}: the row was given a picture meanwhile; left as it is`);
    }

    // Only after a generation; a copy cost the provider nothing.
    if (result.how !== "copied" && index < todo.length - 1) await sleep(PAUSE_BETWEEN_DRAWINGS_MS);
  }
  return summary;
}

/** The run in a few lines, for the end of the output. */
export function formatSummary(summary: RunSummary): string[] {
  const would = summary.dryRun ? "would be " : "";
  const lines = [
    `${summary.listed} word${summary.listed === 1 ? "" : "s"} with no picture.`,
    `  ${summary.drawn} ${would}drawn` +
      (summary.replaced ? `, ${summary.replaced} ${would}redrawn from the authored scene in place of a gloss-only picture` : "") +
      `, ${summary.copied} ${would}copied from the store for nothing.`,
  ];
  if (summary.dryRun) {
    lines.push(`  That is ${summary.drawn + summary.replaced} image generation${summary.drawn + summary.replaced === 1 ? "" : "s"}. Nothing was drawn or written.`);
  } else {
    lines.push(`  ${summary.written} row${summary.written === 1 ? "" : "s"} given a picture.`);
    if (summary.unfiled) lines.push(`  ${summary.unfiled} drawn but not kept in the store.`);
    if (summary.alreadyFilled) lines.push(`  ${summary.alreadyFilled} left alone: given a picture while this ran.`);
  }
  if (summary.beyondLimit) lines.push(`  ${summary.beyondLimit} more left for another run (--limit).`);
  if (summary.unfileable.length) lines.push(`  ${summary.unfileable.length} the store cannot file (listed above).`);
  if (summary.skipped.length) lines.push(`  ${summary.skipped.length} turned away by word-asset (listed above).`);
  if (summary.failed.length) lines.push(`  ${summary.failed.length} failed; run again to retry them.`);
  if (summary.storeMissing) lines.push(`  ${STORE_MISSING_WARNING}`);
  if (summary.stopped) lines.push(`Stopped early: ${summary.stopped}`);
  return lines;
}

/** Whether the run should exit non-zero: it stopped early, or a word failed. */
export function runFailed(summary: RunSummary): boolean {
  return summary.stopped !== null || summary.failed.length > 0;
}
