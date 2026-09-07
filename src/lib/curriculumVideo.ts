/**
 * The video paper trail for the curriculum tracks.
 *
 * Every track word has to be met in real speech eventually — that is the
 * whole design (video is the on-ramp, the lessons are the scaffold). Two pure
 * functions keep the trail honest:
 *
 *   videoNeedsMarkdown   the shopping list: per lesson, what a clip should
 *                        show, which channels to mine first, the Arabic
 *                        searches to run, and per word the surface forms a
 *                        caption would actually contain.
 *   matchTranscripts     what is already in the library: every uploaded
 *                        transcript line, caption line or published clip
 *                        that contains a track word, so a lesson's clips
 *                        can be harvested from videos already on hand before
 *                        anyone goes looking for new ones.
 *
 * Matching is on normalizeArabic'd whole words, the same normalisation the
 * clip miner and the MSA-leak detector use, so a hit here is a hit there.
 */
import { normalizeArabic } from "../../supabase/functions/_shared/msaLeakDetector";
import { lessonSourceKey, type Syllabus, type Track, type TrackLesson, type TrackVocabulary } from "./curriculumTracks";

/** A line of speech from anywhere in the library. */
export interface SpeechLine {
  /** Which table it came from. */
  source: "discover_video" | "caption_line" | "published_clip";
  dialect: string;
  videoId: string;
  videoTitle: string;
  text: string;
  startMs: number | null;
  endMs: number | null;
}

export interface WordHit {
  lessonKey: string;
  slug: string;
  arabic: string;
  english: string;
  surface: string;
  line: SpeechLine;
}

export interface Surface {
  /** As an author wrote it, for display. */
  display: string;
  /** normalizeArabic'd, for matching. */
  norm: string;
}

/**
 * The surface forms a caption could contain for this word, de-duplicated on
 * their normalised form. The definite form is added for every surface that
 * lacks it: a lesson teaches كرسي, a caption says الكرسي, and a miner that
 * only knew the bare word would report the chair as unfilmed.
 */
export function wordSurfaces(word: Pick<TrackVocabulary, "arabic" | "variants">): Surface[] {
  const out = new Map<string, string>();
  const add = (raw: string) => {
    const norm = normalizeArabic(raw);
    if (norm && !out.has(norm)) out.set(norm, raw.trim());
  };
  for (const s of [word.arabic, ...(word.variants ?? [])]) {
    add(s);
    if (!/^ال/.test(s.trim()) && !/\s/.test(s.trim())) add(`ال${s.trim()}`);
  }
  return [...out].map(([norm, display]) => ({ display, norm }));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word containment on normalised text. A single conjunction clitic
 * (و / ف) is allowed in front of the word because captions write it attached
 * — وماي is "and water", not a different word.
 */
function containsWhole(haystack: string, needle: string): boolean {
  return new RegExp(`(^|[\\s\\p{P}])[وف]?${escapeRe(needle)}($|[\\s\\p{P}])`, "u").test(haystack);
}

/**
 * Find every line that contains a track word. Lines are matched only against
 * the tracks of their own dialect — a Gulf caption is no evidence for an
 * Egyptian lesson even when the word is spelled the same.
 */
export function matchTranscripts(tracks: Track[], lines: SpeechLine[]): WordHit[] {
  const index = new Map<string, Array<{ track: Track; lesson: TrackLesson; word: TrackVocabulary; surfaces: Surface[] }>>();
  for (const track of tracks) {
    const list = index.get(track.dialect) ?? [];
    for (const lesson of track.lessons) {
      for (const word of lesson.vocabulary) list.push({ track, lesson, word, surfaces: wordSurfaces(word) });
    }
    index.set(track.dialect, list);
  }
  const hits: WordHit[] = [];
  for (const line of lines) {
    const candidates = index.get(line.dialect);
    if (!candidates) continue;
    const norm = normalizeArabic(line.text);
    if (!norm) continue;
    for (const c of candidates) {
      const surface = c.surfaces.find((s) => containsWhole(norm, s.norm));
      if (!surface) continue;
      hits.push({
        lessonKey: lessonSourceKey(c.track.dialect, c.track.stage, c.lesson.lesson_number),
        slug: c.lesson.slug,
        arabic: c.word.arabic,
        english: c.word.english,
        surface: surface.display,
        line,
      });
    }
  }
  return hits;
}

function ms(value: number | null): string {
  if (value === null) return "?:??";
  const total = Math.floor(value / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

/** The needs manifest for one dialect. */
export function videoNeedsMarkdown(syllabus: Syllabus, tracks: Track[]): string {
  const dialect = tracks[0]?.dialect ?? "";
  const out: string[] = [
    `# Video needs — ${dialect}`,
    "",
    "Generated from `curriculum/tracks/` by `scripts/build-video-needs.ts`; do not edit by hand.",
    "",
    "One section per lesson: the scene a clip should show, the channels already in",
    "`content_channels` worth mining first, YouTube searches to run in Arabic, and",
    "every word with the surface forms a caption would contain. Run",
    "`scripts/curriculum-video-coverage.ts` against the database to see which of",
    "these are already covered by uploaded videos, caption index lines or published clips.",
    "",
  ];
  for (const track of [...tracks].sort((a, b) => a.stage - b.stage)) {
    const stage = syllabus.stages.find((s) => s.stage === track.stage);
    out.push(`## Stage ${track.stage} — ${stage?.name ?? ""} (${stage?.cefr ?? ""})`, "");
    for (const lesson of track.lessons) {
      const slot = stage?.lessons.find((l) => l.slug === lesson.slug);
      out.push(`### ${lessonSourceKey(track.dialect, track.stage, lesson.lesson_number)} · ${lesson.title}`, "");
      out.push(`**Scene:** ${lesson.video_needs.scene}`, "");
      if (slot?.video_scene) out.push(`**Syllabus guidance:** ${slot.video_scene}`, "");
      if (lesson.video_needs.channels.length) out.push(`**Mine first:** ${lesson.video_needs.channels.join(", ")}`, "");
      out.push(`**Search:** ${lesson.video_needs.queries.map((q) => `\`${q}\``).join(" · ")}`, "");
      out.push("| Word | Gloss | Match any of | Look for |", "|---|---|---|---|");
      for (const w of lesson.vocabulary) {
        out.push(`| ${cell(w.arabic)} | ${cell(w.english)} | ${wordSurfaces(w).map((x) => cell(x.display)).join("، ")} | ${cell(w.video_hint ?? w.image_scene)} |`);
      }
      out.push("");
    }
  }
  return out.join("\n");
}

export interface CoverageSummary {
  dialect: string;
  words: number;
  covered: number;
  lines: number;
}

/** The coverage report for one dialect: what the library already has, then what is still missing. */
export function coverageMarkdown(tracks: Track[], hits: WordHit[], generatedAt: string): { markdown: string; summary: CoverageSummary } {
  const dialect = tracks[0]?.dialect ?? "";
  const byWord = new Map<string, WordHit[]>();
  for (const h of hits) {
    const key = `${h.lessonKey}|${h.arabic}`;
    byWord.set(key, [...(byWord.get(key) ?? []), h]);
  }
  let words = 0;
  let covered = 0;
  const out: string[] = [];
  const missing: string[] = [];
  for (const track of [...tracks].sort((a, b) => a.stage - b.stage)) {
    for (const lesson of track.lessons) {
      const key = lessonSourceKey(track.dialect, track.stage, lesson.lesson_number);
      out.push(`## ${key} · ${lesson.title}`, "");
      for (const w of lesson.vocabulary) {
        words += 1;
        const list = byWord.get(`${key}|${w.arabic}`) ?? [];
        if (list.length === 0) {
          missing.push(`- ${key} · ${w.arabic} (${w.english})`);
          continue;
        }
        covered += 1;
        out.push(`**${w.arabic}** — ${w.english}: ${list.length} line(s)`, "");
        for (const h of list.slice(0, 5)) {
          out.push(`- [${h.line.source}] ${cell(h.line.videoTitle)} (${h.line.videoId}) ${ms(h.line.startMs)}–${ms(h.line.endMs)}: ${cell(h.line.text)}`);
        }
        if (list.length > 5) out.push(`- … and ${list.length - 5} more`);
        out.push("");
      }
    }
  }
  out.push("## Still to find", "");
  out.push(missing.length ? missing.join("\n") : "Every word has at least one line in the library.");
  out.push("");
  const header = [
    `# Video coverage — ${dialect}`,
    "",
    `Generated ${generatedAt} by \`scripts/curriculum-video-coverage.ts\` from discover_videos transcripts, the caption index and published clips.`,
    "",
    `**${covered} of ${words} words** have at least one line in the library; ${words - covered} still need a video.`,
    "",
  ];
  return { markdown: [...header, ...out].join("\n"), summary: { dialect, words, covered, lines: hits.length } };
}
