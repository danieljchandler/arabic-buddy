#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net
/**
 * A clip for every action in the curriculum (quiz Phase 5).
 *
 * "Say it" (step 7) shows an action word's animation where it would show the
 * word's picture, and the picture question (step 3) can deal one as an
 * option; a clip exists only once this has made it. For every
 * `vocabulary_words` row that qualifies — a verb by its category ("Verb",
 * "Verb — routine" and the rest), or an action noun, whose gloss keys an
 * action — it asks the shared asset store for the action's clip, once per
 * action: every dialect's "eat" is one clip.
 *
 * The clip comes through `word-asset` (`ensure`, `kind: "animation"`), called
 * with the service-role key, which is the only caller it makes clips for:
 *
 *   - a poster is drawn in the Ink picture style, then animated by Veo 3.1
 *     Lite as its first and last frame, so the clip loops; both go in the
 *     `word-animations` bucket;
 *   - nothing is charged to any learner. The project's provider keys pay:
 *     about $0.27 a clip on Google's API (the dry run prints the bill);
 *   - nothing is written onto `vocabulary_words`. The quiz reads a clip from
 *     the store by the word's gloss.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-env --allow-read --allow-net \
 *     scripts/curriculum-animations.ts [--dialect Gulf] [--stage 2] [--limit 5] [--dry-run]
 *
 *   --dialect  Gulf, Egyptian or Yemeni: only that dialect's words
 *   --stage    1, 2 or 3: only the words of that stage's lessons
 *   --limit    at most N clips this run (actions, not words)
 *   --dry-run  list the actions, which are in the store and which would be
 *              made, and what making them would cost. Reads only.
 *
 * Order matters: apply the `word_assets` migration (Phase 2b) and the
 * `word-animations` bucket migration, and deploy this `word-asset`, first.
 * Without the table or the bucket a real run makes nothing and says so; the
 * dry run still prints what it would make. It is safe to run again: an action
 * already in the store costs nothing and is not counted against `--limit`.
 *
 * All the deciding is in curriculum-animations-core.ts, which the Vitest
 * suite covers against a stubbed project (src/test/curriculumAnimations.test.ts).
 * This file reads the environment and prints. A local tool with no CI gate.
 */
import {
  animationRunFailed,
  formatAnimationSummary,
  parseArgs,
  projectFromEnv,
  runAnimations,
  USAGE,
} from "./curriculum-animations-core.ts";

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
  options.limit === null ? "no limit" : `at most ${options.limit} clips`,
].join(", ");
console.log(
  `Curriculum animations${options.dryRun ? " (dry run: nothing is made or written)" : ""}: ` +
    `${filters}, on ${new URL(project.supabaseUrl).host}\n`,
);

try {
  const summary = await runAnimations({ ...project, fetch, log: (line) => console.log(line) }, options);
  console.log(`\n${formatAnimationSummary(summary).join("\n")}`);
  Deno.exit(animationRunFailed(summary) ? 1 : 0);
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  Deno.exit(1);
}
