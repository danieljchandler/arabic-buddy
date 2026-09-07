#!/usr/bin/env -S npx vite-node
/**
 * Validate the authored curriculum tracks against the syllabus and run every
 * Arabic field through the MSA-leak detector for its dialect. This is the
 * same check `src/test/curriculumTracks.test.ts` runs in CI, in a form an
 * author can run on one dialect or one stage while writing.
 *
 *   npx vite-node scripts/check-curriculum-tracks.ts [--dialect Egyptian] [--stage 2] [--partial]
 *
 * --partial accepts a stage whose lesson slots are not all written yet; CI
 * never passes it.
 */
import { detectMsaLeaks } from "../supabase/functions/_shared/msaLeakDetector";
import {
  TRACK_DIALECTS,
  arabicSamples,
  trackWordCounts,
  validateSyllabus,
  validateTrack,
  type TrackDialect,
} from "../src/lib/curriculumTracks";
import { loadDialectTracks, loadSyllabus } from "./curriculum/loadTracks";

const args = process.argv.slice(2);
const opt = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const onlyDialect = opt("dialect");
const onlyStage = opt("stage") ? Number(opt("stage")) : null;
const partial = args.includes("--partial");

const syllabus = loadSyllabus();
const problems: string[] = validateSyllabus(syllabus).map((m) => `syllabus: ${m}`);

for (const dialect of TRACK_DIALECTS) {
  if (onlyDialect && onlyDialect.toLowerCase() !== dialect.toLowerCase()) continue;
  const tracks = loadDialectTracks(dialect as TrackDialect).filter((t) => onlyStage === null || t.stage === onlyStage);
  if (tracks.length === 0) {
    console.log(`${dialect}: no stages on disk`);
    continue;
  }
  const seen = new Map<string, string>();
  for (const track of tracks) {
    problems.push(...validateTrack(track, syllabus, seen, { allowPartial: partial }));
    for (const sample of arabicSamples(track)) {
      const result = detectMsaLeaks(sample.text, dialect);
      if (result.leaks.length > 0) {
        problems.push(`${sample.path}: not ${dialect} — ${result.leaks.join(", ")} in "${sample.text}"`);
      }
    }
  }
  const counts = trackWordCounts(tracks);
  const perStage = Object.entries(counts.byStage).map(([s, n]) => `stage ${s}: ${n}`).join(", ");
  console.log(`${dialect}: ${tracks.length} stage(s), ${counts.total} words (${perStage})`);
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nall tracks valid");
