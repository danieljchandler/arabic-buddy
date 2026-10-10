#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net
/**
 * Story passages for the curriculum from the reading library (quiz Phase 6).
 *
 * The quiz's top step, "in a story", asks a mature word in two sentences of a
 * story with the word muted. For every `vocabulary_words` row it looks for a
 * published story in the word's dialect that already uses the word, cuts the
 * two sentences around it from the story's dialect text, and files them in
 * the shared store (`word_assets`, `kind: "story_line"`) for every learner of
 * the word — the same search, and the same source rule, as `word-asset`
 * runs when a learner misses:
 *
 *   - the dialect text only, never the fusha the story was imported from;
 *   - published stories, under a public-domain or CC0 licence only;
 *   - the story's own dialect, and its current rendering.
 *
 * No function and no model is called, nobody is charged, and nothing is
 * written onto `vocabulary_words`. A word no story uses is left for its first
 * learner at the top step, whose miss writes one on their dialogue allowance.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-env --allow-read --allow-net \
 *     scripts/curriculum-stories.ts [--dialect Gulf] [--stage 2] [--limit 20] [--dry-run]
 *
 *   --dialect  Gulf, Egyptian or Yemeni: only that dialect's words
 *   --stage    1, 2 or 3: only the words of that stage's lessons
 *   --limit    at most N passages filed this run
 *   --dry-run  list what the library would lend each word, and what was left
 *              out of it and why. Reads only.
 *
 * It also takes back what a story stopped lending: a filed story passage
 * whose story was unpublished, re-licensed, moved to another dialect,
 * re-converted or deleted has its row deleted (listed only, in a dry run),
 * and the word is searched again.
 *
 * Order matters: apply the `word_assets` migration (Phase 2b) first. Without
 * it a real run files nothing and says so; the dry run still lists what it
 * would take. It is safe to run again: a word already in the store is left
 * alone, unless what is filed is a passage a learner's miss wrote, which a
 * published story's sentences take the place of.
 *
 * All the deciding is in curriculum-stories-core.ts, which the Vitest suite
 * covers against the in-memory project (src/test/curriculumStories.test.ts).
 * This file reads the environment and prints. A local tool with no CI gate.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getDialectForbiddenTokens, primeDialectPrompt } from "../supabase/functions/_shared/dialectHelpers.ts";
import { detectMsaLeaks } from "../supabase/functions/_shared/msaLeakDetector.ts";
import type { StoryClient } from "../supabase/functions/_shared/wordStoryLine.ts";
import type { WordAssetClient } from "../supabase/functions/_shared/wordAssets.ts";
import {
  type AssetRowDeleter,
  formatStorySummary,
  parseArgs,
  projectFromEnv,
  runStories,
  storyRunFailed,
  USAGE,
} from "./curriculum-stories-core.ts";

const parsed = parseArgs(Deno.args);
if ("help" in parsed) {
  console.log(USAGE);
  Deno.exit(0);
}
if ("error" in parsed) {
  console.error(`${parsed.error}\n\n${USAGE}`);
  Deno.exit(2);
}
const { options } = parsed;

let configToml: string | null = null;
try {
  configToml = Deno.readTextFileSync(new URL("../supabase/config.toml", import.meta.url));
} catch {
  // SUPABASE_URL has to say where, then.
}
const project = projectFromEnv(Deno.env.toObject(), configToml);
if ("error" in project) {
  console.error(`${project.error}\n\n${USAGE}`);
  Deno.exit(2);
}
// The rulebook's forbidden tokens are read from the project the run is on.
Deno.env.set("SUPABASE_URL", project.supabaseUrl);

const client = createClient(project.supabaseUrl, project.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}) as unknown as StoryClient & WordAssetClient & AssetRowDeleter;

const filters = [
  options.dialect ?? "every dialect",
  options.stage === null ? "every stage" : `stage ${options.stage}`,
  options.limit === null ? "no limit" : `at most ${options.limit} passages`,
].join(", ");
console.log(
  `Curriculum story passages${options.dryRun ? " (dry run: nothing is written)" : ""}: ` +
    `${filters}, on ${new URL(project.supabaseUrl).host}\n`,
);

try {
  const summary = await runStories(
    {
      ...project,
      fetch,
      client,
      log: (line) => console.log(line),
      leaksFor: async (dialect) => {
        await primeDialectPrompt(dialect);
        return (text) => detectMsaLeaks(text, dialect, getDialectForbiddenTokens(dialect)).leaks;
      },
    },
    options,
  );
  console.log(`\n${formatStorySummary(summary).join("\n")}`);
  Deno.exit(storyRunFailed(summary) ? 1 : 0);
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  Deno.exit(1);
}
