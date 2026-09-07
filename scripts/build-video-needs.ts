#!/usr/bin/env -S npx vite-node
/**
 * Rewrite curriculum/video-needs/<dialect>.md — the per-lesson shopping list
 * of clips to find — from the curriculum tracks.
 *
 *   npx vite-node scripts/build-video-needs.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { videoNeedsMarkdown } from "../src/lib/curriculumVideo";
import { TRACK_DIALECTS } from "../src/lib/curriculumTracks";
import { loadDialectTracks, loadSyllabus } from "./curriculum/loadTracks";

const OUT = resolve(__dirname, "../curriculum/video-needs");
mkdirSync(OUT, { recursive: true });
const syllabus = loadSyllabus();
for (const dialect of TRACK_DIALECTS) {
  const tracks = loadDialectTracks(dialect);
  if (tracks.length === 0) continue;
  const path = resolve(OUT, `${dialect.toLowerCase()}.md`);
  writeFileSync(path, videoNeedsMarkdown(syllabus, tracks));
  console.log(`wrote ${path}`);
}
