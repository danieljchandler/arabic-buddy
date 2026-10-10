/**
 * The deciding half of `scripts/curriculum-stories.ts` (quiz Phase 6, "words
 * in stories").
 *
 * For every curriculum word, make sure the shared store holds its story
 * passage from the reading library where a published story already uses the
 * word: two sentences around it, from the story's dialect text, under a
 * licence that lets them be shown on their own (`findStoryPassage` and its
 * source rule in `_shared/wordStoryLine.ts`, the same search `word-asset`
 * runs on a learner's miss). Nothing is written onto `vocabulary_words`: the
 * quiz reads a passage from the store by the word, its sense and its dialect.
 *
 * It calls no function and no model, and charges nobody. It reads the
 * library and writes `word_assets` with the service-role key, the one writer
 * the table takes. A word no story uses is left alone: its passage is written
 * the first time a learner reaches the top step with it, on that learner's
 * dialogue allowance, and this run would only have spent provider credit on
 * every word in the curriculum to save each of them one wait.
 *
 * What it takes the place of: a passage a learner's miss wrote
 * (`isReplaceable`: an unapproved `generated` one), since a published story's
 * sentences were read by the person who published it and a written passage
 * was read by nobody. Never a passage someone authored, reviewed or approved.
 *
 * Everything takes the client and `fetch` as parameters, so the Vitest suite
 * drives it against the in-memory project (`src/test/curriculumStories.test.ts`).
 * Nothing in the repo's tests or CI reaches a real project.
 */
import {
  isReplaceable,
  lookupAsset,
  putAsset,
  replaceAsset,
  assetKey,
  type AssetDialect,
  type AssetKey,
  type WordAsset,
  type WordAssetClient,
} from "../supabase/functions/_shared/wordAssets.ts";
import {
  findStoryPassage,
  PUBLISHED_STORY_STATUS,
  storyDialect,
  storyLicenseShareable,
  storyPassageAsset,
  type StoryClient,
  type StoryPassage,
} from "../supabase/functions/_shared/wordStoryLine.ts";
import { listCurriculumWords, type AnimationWordRow } from "./curriculum-animations-core.ts";
import type { PictureOptions, RunContext } from "./curriculum-pictures-core.ts";

export { parseArgs, projectFromEnv } from "./curriculum-pictures-core.ts";

/** The same four flags as the pictures script; `--limit` counts passages filed. */
export type StoryOptions = PictureOptions;

export const USAGE = [
  "Usage: deno run --allow-env --allow-read --allow-net scripts/curriculum-stories.ts",
  "         [--dialect Gulf|Egyptian|Yemeni] [--stage 1|2|3] [--limit N] [--dry-run]",
  "",
  "  --dialect  only this dialect's words",
  "  --stage    only the words of this stage's lessons",
  "  --limit    at most N passages filed (a word already in the store is not counted)",
  "  --dry-run  list the passages the reading library holds for the words; writes nothing",
  "",
  "Needs SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_URL unless supabase/config.toml names the project.",
].join("\n");

/** Failures in a row after which the run stops: something is down. */
export const MAX_CONSECUTIVE_FAILURES = 3;

export const STORE_MISSING =
  "word_assets is not on this project (apply 20261009130000_word_assets, Phase 2b): nothing can be filed.";

export interface StoryRunContext extends RunContext {
  /** A service-role client: the story search and the store both take it. */
  client: StoryClient & WordAssetClient;
  /**
   * The leak scan for a dialect, with the rulebook's tokens loaded where the
   * caller can load them. Without it, a story's sentences are filed on the
   * source rule alone.
   */
  leaksFor?: (dialect: AssetDialect) => Promise<(text: string) => string[]>;
}

// ── The curriculum ──────────────────────────────────────────────────────────

/** One key to have a passage for, and the words that share it. */
export interface StoryWordPlan {
  key: AssetKey;
  row: AnimationWordRow;
  words: AnimationWordRow[];
}

/** One plan per key (word, sense and dialect), in the order the words came; words the store cannot key are counted. */
export function planStoryWords(rows: readonly AnimationWordRow[]): { plans: StoryWordPlan[]; unkeyed: number } {
  const byKey = new Map<string, StoryWordPlan>();
  let unkeyed = 0;
  for (const row of rows) {
    const key = assetKey({
      kind: "story_line",
      word: row.word_arabic,
      gloss: (row.word_english ?? "").trim(),
      dialect: row.dialect_module,
    });
    if (!key) {
      unkeyed++;
      continue;
    }
    const id = `${key.dialect}\u0000${key.conceptKey}`;
    const plan = byKey.get(id);
    if (plan) plan.words.push(row);
    else byKey.set(id, { key, row, words: [row] });
  }
  return { plans: [...byKey.values()], unkeyed };
}

// ── The shelf ───────────────────────────────────────────────────────────────

export interface ShelfStory {
  id: string;
  title: string;
  dialect: string;
  license: string;
  status: string;
}

export interface ShelfSummary {
  stories: number;
  /** Stories the source rule lets lend, by the dialect they lend in. */
  lending: Record<AssetDialect, number>;
  unpublished: number;
  /** Licences that ask for a credit, or none set: counted by licence. */
  licence: Record<string, number>;
  /** Published, shareable, and in no dialect the store keys on (Levantine, MSA): counted by label. */
  otherDialect: Record<string, number>;
}

/** What the reading library may lend, and why each story it may not is left out. */
export function describeShelf(stories: readonly ShelfStory[]): ShelfSummary {
  const summary: ShelfSummary = {
    stories: stories.length,
    lending: { Gulf: 0, Egyptian: 0, Yemeni: 0 },
    unpublished: 0,
    licence: {},
    otherDialect: {},
  };
  for (const story of stories) {
    if (story.status !== PUBLISHED_STORY_STATUS) {
      summary.unpublished++;
    } else if (!storyLicenseShareable(story.license)) {
      const label = story.license || "(none)";
      summary.licence[label] = (summary.licence[label] ?? 0) + 1;
    } else {
      const dialect = storyDialect(story.dialect);
      if (dialect) summary.lending[dialect]++;
      else {
        const label = story.dialect || "(none)";
        summary.otherDialect[label] = (summary.otherDialect[label] ?? 0) + 1;
      }
    }
  }
  return summary;
}

const counts = (record: Record<string, number>) =>
  Object.entries(record)
    .map(([label, n]) => `${n} ${label}`)
    .join(", ");

export function formatShelf(shelf: ShelfSummary): string[] {
  const lending = shelf.lending.Gulf + shelf.lending.Egyptian + shelf.lending.Yemeni;
  const lines = [
    `The reading library: ${shelf.stories} stories, ${lending} of which may lend a passage ` +
      `(Gulf ${shelf.lending.Gulf}, Egyptian ${shelf.lending.Egyptian}, Yemeni ${shelf.lending.Yemeni}).`,
  ];
  if (shelf.unpublished) lines.push(`  left out, not published: ${shelf.unpublished}`);
  if (Object.keys(shelf.licence).length) lines.push(`  left out, a licence that asks for a credit: ${counts(shelf.licence)}`);
  if (Object.keys(shelf.otherDialect).length) {
    lines.push(`  left out, not a dialect the store keys on: ${counts(shelf.otherDialect)}`);
  }
  return lines;
}

async function readShelf(client: StoryClient): Promise<ShelfStory[]> {
  // Every story, published or not, so the summary can say what was left out.
  // Titles and labels only; the passages come from `findStoryPassage`.
  const settled = await client
    .from("authentic_stories")
    .select("id, title, dialect, license, status")
    .order("created_at", { ascending: true })
    .limit(1000);
  if (settled.error) throw new Error(`could not read authentic_stories: ${settled.error.message}`);
  return Array.isArray(settled.data) ? (settled.data as ShelfStory[]) : [];
}

// ── The run ─────────────────────────────────────────────────────────────────

export interface StorySummary {
  dryRun: boolean;
  /** Curriculum words in the filters. */
  words: number;
  /** Distinct keys among them. */
  keys: number;
  /** Words the store cannot key (no Arabic, no sense that survives the folding). */
  unkeyed: number;
  /** Keys whose passage is already filed and not a learner-written one. */
  have: number;
  /** Keys a story passage was filed for (a real run), or would be (a dry run). */
  taken: number;
  /** Of `taken`, how many take the place of a learner-written passage. */
  replacing: number;
  /** Keys no published story holds a passage for. */
  none: number;
  /** Passages this run could not file. */
  failed: number;
  /** Keys a passage was found for and not filed, `--limit` being reached. */
  leftForLater: number;
  storeMissing: boolean;
  shelf: ShelfSummary | null;
  /** Why the run stopped early, if it did. */
  stopped: string | null;
}

const describePassage = (plan: StoryWordPlan, passage: StoryPassage) => {
  const words = [...new Set(plan.words.map((w) => `${w.word_arabic} (${w.dialect_module ?? "?"})`))];
  const lines = passage.lines.map((line) => line.index + 1).join("–");
  return (
    `${words.join(", ")} ← “${passage.story.title || passage.story.titleArabic}”, line ${lines}: ` +
    `${passage.sentences[0].arabic} | ${passage.sentences[1].arabic}`
  );
};

/**
 * The whole run. A dry run reads the curriculum, the library and the store,
 * and writes nothing; a real one files each passage found, up to `--limit`.
 */
export async function runStories(ctx: StoryRunContext, options: StoryOptions): Promise<StorySummary> {
  const log = ctx.log ?? (() => {});
  const rows = await listCurriculumWords(ctx, options);
  const { plans, unkeyed } = planStoryWords(rows);
  const summary: StorySummary = {
    dryRun: options.dryRun,
    words: rows.length,
    keys: plans.length,
    unkeyed,
    have: 0,
    taken: 0,
    replacing: 0,
    none: 0,
    failed: 0,
    leftForLater: 0,
    storeMissing: false,
    shelf: null,
    stopped: null,
  };

  summary.shelf = describeShelf(await readShelf(ctx.client));
  for (const line of formatShelf(summary.shelf)) log(line);
  log("");

  const scans = new Map<AssetDialect, (text: string) => string[]>();
  const leaksIn = async (dialect: AssetDialect) => {
    if (!ctx.leaksFor) return () => [];
    if (!scans.has(dialect)) scans.set(dialect, await ctx.leaksFor(dialect));
    return scans.get(dialect)!;
  };

  let failuresInARow = 0;
  for (const plan of plans) {
    const { asset: filed, missingTable } = await lookupAsset(ctx.client, plan.key);
    if (missingTable && !summary.storeMissing) {
      summary.storeMissing = true;
      if (!options.dryRun) {
        summary.stopped = STORE_MISSING;
        log(STORE_MISSING);
        return summary;
      }
      log(`${STORE_MISSING} Listing what a run would take anyway.`);
    }
    const replacing: WordAsset | null = filed && isReplaceable(filed) ? filed : null;
    if (filed && !replacing) {
      summary.have++;
      continue;
    }

    const passage = await findStoryPassage(ctx.client, plan.key, { leaksIn: await leaksIn(plan.key.dialect!) });
    if (!passage) {
      summary.none++;
      continue;
    }

    if (options.dryRun) {
      summary.taken++;
      if (replacing) summary.replacing++;
      log(`would take${replacing ? " (in place of a written one)" : ""}: ${describePassage(plan, passage)}`);
      continue;
    }
    if (options.limit !== null && summary.taken >= options.limit) {
      summary.leftForLater++;
      continue;
    }

    const asset = storyPassageAsset(passage, plan.key.styleVersion);
    const outcome = replacing
      ? await replaceAsset(ctx.client, plan.key, replacing, asset)
      : await putAsset(ctx.client, plan.key, asset);
    if (outcome.status === "stored" || outcome.status === "replaced") {
      summary.taken++;
      if (outcome.status === "replaced") summary.replacing++;
      failuresInARow = 0;
      log(`filed${outcome.status === "replaced" ? " (in place of a written one)" : ""}: ${describePassage(plan, passage)}`);
    } else if (outcome.status === "taken") {
      // Filed by someone else since the lookup, or approved: theirs stands.
      summary.have++;
      failuresInARow = 0;
    } else {
      summary.failed++;
      log(`could not file ${plan.row.word_arabic} (${plan.key.dialect}): ${outcome.error}`);
      if (++failuresInARow >= MAX_CONSECUTIVE_FAILURES) {
        summary.stopped = `${MAX_CONSECUTIVE_FAILURES} passages in a row could not be filed; stopping.`;
        log(summary.stopped);
        return summary;
      }
    }
  }
  return summary;
}

export function formatStorySummary(summary: StorySummary): string[] {
  const verb = summary.dryRun ? "would take" : "filed";
  const lines = [
    `${summary.words} curriculum words, ${summary.keys} distinct (${summary.unkeyed} the store cannot key).`,
    `  already in the store: ${summary.have}`,
    `  ${verb} from a published story: ${summary.taken}` +
      (summary.replacing ? ` (${summary.replacing} in place of a passage a learner's miss wrote)` : ""),
    `  no published story uses the word: ${summary.none}`,
  ];
  if (summary.leftForLater) lines.push(`  found, left for a later run (--limit): ${summary.leftForLater}`);
  if (summary.failed) lines.push(`  could not be filed: ${summary.failed}`);
  lines.push(
    "Cost: none. No model is called and nobody is charged. A word no story uses gets a passage written " +
      "the first time a learner reaches the top step with it, on that learner's dialogue allowance.",
  );
  if (summary.storeMissing) lines.push(STORE_MISSING);
  if (summary.stopped) lines.push(`Stopped: ${summary.stopped}`);
  return lines;
}

/** Whether the run should exit non-zero. */
export function storyRunFailed(summary: StorySummary): boolean {
  return summary.stopped !== null || summary.failed > 0;
}
