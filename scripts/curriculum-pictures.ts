#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net
/**
 * A picture for every curriculum word (quiz Phase 3).
 *
 * Steps 3, 5 and 7 of the quiz ladder ("pick the picture", "pick the word"
 * from its picture, "say it" from its picture) only fire for a word that has
 * a picture, and the authored tracks ship without one. This fills them in,
 * on brand, once per word: for every `vocabulary_words` row with no
 * `image_url` it asks the shared asset store for the word's picture and
 * writes the url onto the row.
 *
 * The picture comes through `word-asset` (`ensure`, `kind: "image"`), called
 * with the service-role key, which is that function's trusted path:
 *
 *   - the row's `image_scene_description` goes along as `scene`. It is the
 *     track word's authored `image_scene`, written there by the curriculum
 *     seed, so nothing is read from curriculum/tracks/ here and a word
 *     imported from a workbook with no scene is drawn from its gloss;
 *   - it is drawn in the Ink style (no photographs, no text) and filed in the
 *     store as `authored`, under the same key a learner's saved word uses, so
 *     a learner who saves the word later is served this picture for nothing;
 *   - nothing is charged to any learner's daily allowance;
 *   - where a learner's miss already filed a picture drawn from the gloss
 *     alone, the authored scene is drawn in its place. A picture someone
 *     authored, reviewed or approved is copied as it is.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-env --allow-read --allow-net \
 *     scripts/curriculum-pictures.ts [--dialect Gulf] [--stage 1] [--limit 20] [--dry-run]
 *
 *   --dialect  Gulf, Egyptian or Yemeni: only that dialect's words
 *   --stage    1, 2 or 3: only the words of that stage's lessons
 *   --limit    at most N words this run
 *   --dry-run  list what would be drawn, redrawn or copied, with the number
 *              of image generations it comes to. Reads only: it calls no
 *              function and writes no row.
 *
 * SUPABASE_URL is read from the environment, else from the project_id in
 * supabase/config.toml. Every real run costs one image generation per word
 * drawn (the dry run prints how many), on the project's provider keys, so
 * start with `--dry-run`, then a small `--limit`, and look at the pictures.
 *
 * Run it after the `word_assets` migration is on the live project and the
 * Phase 3 `word-asset` is deployed. Before the migration it still works, and
 * says so: every picture is drawn and written onto its row, but none is kept
 * in the store. It is safe to run again: a row that has a picture is not
 * listed, and a word already in the store is copied, not redrawn.
 *
 * All the deciding is in curriculum-pictures-core.ts, which the Vitest suite
 * covers against a stubbed project (src/test/curriculumPictures.test.ts).
 * This file reads the environment and prints. It is a local tool with no CI
 * gate, like the other scripts that need real keys.
 */
import {
  formatSummary,
  parseArgs,
  projectFromEnv,
  runFailed,
  runPictures,
  USAGE,
} from "./curriculum-pictures-core.ts";

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

const filters = [
  options.dialect ?? "every dialect",
  options.stage === null ? "every stage" : `stage ${options.stage}`,
  options.limit === null ? "no limit" : `at most ${options.limit}`,
].join(", ");
console.log(
  `Curriculum pictures${options.dryRun ? " (dry run: nothing is drawn or written)" : ""}: ` +
    `${filters}, on ${new URL(project.supabaseUrl).host}\n`,
);

try {
  const summary = await runPictures({ ...project, fetch, log: (line) => console.log(line) }, options);
  console.log(`\n${formatSummary(summary).join("\n")}`);
  Deno.exit(runFailed(summary) ? 1 : 0);
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  Deno.exit(1);
}
