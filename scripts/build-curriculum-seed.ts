#!/usr/bin/env -S npx vite-node
/**
 * Regenerate the curriculum seed migration from curriculum/tracks/.
 *
 *   npx vite-node scripts/build-curriculum-seed.ts [--partial]
 *
 * Validates first (same checks as check-curriculum-tracks.ts) and refuses to
 * write a seed from invalid tracks. The committed migration is compared to
 * this output by src/test/curriculumSeed.test.ts.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectMsaLeaks } from "../supabase/functions/_shared/msaLeakDetector";
import { SEED_MIGRATION_NAME, buildSeedSql } from "../src/lib/curriculumSeed";
import { TRACK_DIALECTS, arabicSamples, validateSyllabus, validateTrack } from "../src/lib/curriculumTracks";
import { loadDialectTracks, loadSyllabus } from "./curriculum/loadTracks";

const partial = process.argv.includes("--partial");
const syllabus = loadSyllabus();
const problems = validateSyllabus(syllabus);
const tracks = TRACK_DIALECTS.flatMap((dialect) => {
  const seen = new Map<string, string>();
  return loadDialectTracks(dialect).map((track) => {
    problems.push(...validateTrack(track, syllabus, seen, { allowPartial: partial }));
    for (const sample of arabicSamples(track)) {
      const leaks = detectMsaLeaks(sample.text, dialect).leaks;
      if (leaks.length) problems.push(`${sample.path}: ${leaks.join(", ")}`);
    }
    return track;
  });
});
if (problems.length) {
  console.error(problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}

const out = resolve(__dirname, `../supabase/migrations/${SEED_MIGRATION_NAME}.sql`);
const sql = buildSeedSql(syllabus, tracks);
writeFileSync(out, sql);
console.log(`wrote ${out} (${(sql.length / 1024).toFixed(0)} KB, ${tracks.length} tracks)`);
