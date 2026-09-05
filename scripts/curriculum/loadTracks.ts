/**
 * Disk half of the curriculum tracks: reads `curriculum/tracks/` into the
 * pure types in src/lib/curriculumTracks.ts. Shared by the check / build
 * scripts and by the Vitest drift guards, so every consumer sees the same
 * lesson set in the same order.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  TRACK_DIALECTS,
  type Syllabus,
  type Track,
  type TrackDialect,
  type TrackLesson,
} from "../../src/lib/curriculumTracks";

export const TRACKS_DIR = resolve(__dirname, "../../curriculum/tracks");

export function loadSyllabus(dir = TRACKS_DIR): Syllabus {
  return JSON.parse(readFileSync(join(dir, "syllabus.json"), "utf8")) as Syllabus;
}

export function dialectDir(dialect: TrackDialect, dir = TRACKS_DIR): string {
  return join(dir, dialect.toLowerCase());
}

/** Stage numbers that have a `_stage.json` for this dialect. */
export function stagesOnDisk(dialect: TrackDialect, dir = TRACKS_DIR): number[] {
  const base = dialectDir(dialect, dir);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .map((name) => /^stage-(\d+)$/.exec(name)?.[1])
    .filter((n): n is string => !!n)
    .map(Number)
    .filter((n) => existsSync(join(base, `stage-${n}`, "_stage.json")))
    .sort((a, b) => a - b);
}

/**
 * Assemble one stage's track from its per-lesson files. Files sort by their
 * `<nn>-` prefix; the validator then holds that order to the syllabus.
 */
export function loadTrack(dialect: TrackDialect, stage: number, dir = TRACKS_DIR): Track {
  const stageDir = join(dialectDir(dialect, dir), `stage-${stage}`);
  const meta = JSON.parse(readFileSync(join(stageDir, "_stage.json"), "utf8")) as Omit<Track, "lessons">;
  const lessons = readdirSync(stageDir)
    .filter((name) => /^\d{2}-.+\.json$/.test(name))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(stageDir, name), "utf8")) as TrackLesson);
  return { ...meta, lessons };
}

export function loadDialectTracks(dialect: TrackDialect, dir = TRACKS_DIR): Track[] {
  return stagesOnDisk(dialect, dir).map((stage) => loadTrack(dialect, stage, dir));
}

export function loadAllTracks(dir = TRACKS_DIR): Track[] {
  return TRACK_DIALECTS.flatMap((dialect) => loadDialectTracks(dialect, dir));
}
