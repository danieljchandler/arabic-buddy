#!/usr/bin/env node
/**
 * Which edge functions a set of changed files actually requires deploying.
 *
 * Edge functions do not deploy with the app. Merging changes the repository and
 * leaves production serving the previous copy, which is a silent, invisible
 * difference: the code says one thing, the running system does another, and
 * every symptom you then debug belongs to code you are not looking at. That
 * cost several rounds of chasing a transcription bug that had already been
 * fixed.
 *
 * The blunt fix is to redeploy everything on every merge, but there are 119
 * functions and that is slow enough that people turn it off. So this works out
 * the smallest correct set instead:
 *
 *   - a change under `supabase/functions/<name>/` deploys `<name>`;
 *   - a change under `supabase/functions/_shared/` deploys every function whose
 *     imports reach that file, following imports through `_shared` as far as
 *     they go — a module three hops down is still bundled into whatever
 *     ultimately imports it;
 *   - `_test/` changes deploy nothing, being the harness rather than the code.
 *
 * Correctness matters more than brevity here: a function left un-deployed is
 * the exact failure this exists to prevent, so the reachability walk is
 * transitive and errs toward deploying.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, normalize } from "node:path";

const FUNCTIONS_ROOT = "supabase/functions";

/** Directories under `supabase/functions` that are not themselves functions. */
const NOT_A_FUNCTION = new Set(["_shared", "_test"]);

/**
 * Relative import specifiers in a module, as written.
 *
 * Deliberately a regex rather than a parser: these are Deno modules with
 * explicit extensions and no build step, so every import that matters is a
 * literal string ending in `.ts`. Bare specifiers and URLs are remote and
 * cannot be affected by a change in this repository, so they are skipped.
 */
export function relativeImports(source) {
  const found = new Set();
  const patterns = [
    /\bfrom\s*["'](\.[^"']+)["']/g,
    /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
    /\bimport\s*["'](\.[^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

/** Resolve an import as written, from the module that wrote it, to a repo path. */
function resolveImport(fromPath, specifier) {
  return normalize(join(dirname(fromPath), specifier)).split("\\").join("/");
}

/**
 * The set of files each module reaches, directly or through other modules.
 *
 * `sources` maps repo-relative path to file contents, which is what lets this
 * be tested against fixtures rather than against the repository it happens to
 * live in.
 */
export function reachableFiles(entry, sources) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const source = sources[current];
    if (source === undefined) continue;
    for (const specifier of relativeImports(source)) {
      queue.push(resolveImport(current, specifier));
    }
  }
  return seen;
}

/**
 * Function names to deploy for `changedPaths`.
 *
 * `sources` is every module that could take part in the import graph, keyed by
 * repo-relative path.
 */
export function functionsToDeploy(changedPaths, sources) {
  const functionNames = new Set();
  for (const path of Object.keys(sources)) {
    const match = path.match(/^supabase\/functions\/([^/]+)\/index\.ts$/);
    if (match && !NOT_A_FUNCTION.has(match[1])) functionNames.add(match[1]);
  }

  const changed = new Set(changedPaths.map((p) => p.split("\\").join("/")));
  const deploy = new Set();

  for (const path of changed) {
    const match = path.match(/^supabase\/functions\/([^/]+)\//);
    if (match && !NOT_A_FUNCTION.has(match[1]) && functionNames.has(match[1])) {
      deploy.add(match[1]);
    }
  }

  // Anything shared that changed pulls in every function that can reach it.
  const changedShared = [...changed].filter((p) => p.startsWith(`${FUNCTIONS_ROOT}/_shared/`));
  if (changedShared.length > 0) {
    for (const name of functionNames) {
      if (deploy.has(name)) continue;
      const reached = reachableFiles(`${FUNCTIONS_ROOT}/${name}/index.ts`, sources);
      if (changedShared.some((shared) => reached.has(shared))) deploy.add(name);
    }
  }

  return [...deploy].sort();
}

/** Every module under `supabase/functions`, keyed by repo-relative path. */
export function readFunctionSources(root = FUNCTIONS_ROOT) {
  const sources = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry).split("\\").join("/");
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts")) sources[path] = readFileSync(path, "utf8");
    }
  };
  walk(root);
  return sources;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// Changed paths arrive on stdin, one per line, which is what `git diff
// --name-only` produces. Names are printed one per line for the same reason.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const stdin = readFileSync(0, "utf8");
  const changed = stdin.split("\n").map((line) => line.trim()).filter(Boolean);
  const names = functionsToDeploy(changed, readFunctionSources());
  if (names.length > 0) console.log(names.join("\n"));
}
