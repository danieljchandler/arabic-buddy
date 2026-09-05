import { describe, expect, it } from "vitest";
import { coverageMarkdown, matchTranscripts, videoNeedsMarkdown, wordSurfaces, type SpeechLine } from "@/lib/curriculumVideo";
import type { Syllabus, Track } from "@/lib/curriculumTracks";

/**
 * The video paper trail: the needs manifest authors hand to whoever hunts for
 * clips, and the coverage report that says which words the library already
 * has on film. Matching must agree with the clip miner — whole words on
 * normalised text, variants included, same-dialect only.
 */

const syllabus: Syllabus = {
  version: 1,
  stages: [
    {
      stage: 1,
      name: "Foundations",
      cefr: "Pre-A1 → A1",
      words_per_lesson: 1,
      lessons: [
        {
          slug: "objects",
          lesson_number: 1,
          title: "Objects",
          theme: "Objects",
          cefr_target: "Pre-A1",
          can_do: ["x"],
          grammar: [],
          culture: "c",
          target_concepts: [{ key: "water", gloss: "water" }],
          video_scene: "Objects named while shown.",
        },
      ],
    },
  ],
};

const track: Track = {
  dialect: "Gulf",
  stage: 1,
  variety: "Neutral",
  lessons: [
    {
      slug: "objects",
      lesson_number: 1,
      title: "Objects",
      title_arabic: "الأشياء",
      description: "d",
      cefr_target: "Pre-A1",
      duration_minutes: 15,
      approach: "a",
      unlock_condition: "u",
      icon: "🏠",
      can_do: ["x"],
      grammar: [],
      culture: [],
      vocabulary: [
        {
          arabic: "ماي",
          transliteration: "maay",
          english: "water",
          category: "noun",
          teaching_note: "t",
          image_scene: "a glass of water",
          concept_key: "water",
          variants: ["الماي", "مويه", "ماي"],
          example: { arabic: "أبي ماي", transliteration: "abi maay", english: "I want water" },
          video_hint: "someone pouring water | with a pipe",
        },
        {
          arabic: "مفتاح",
          transliteration: "miftaaḥ",
          english: "key",
          category: "noun",
          teaching_note: "t",
          image_scene: "a key",
          example: { arabic: "وين المفتاح", transliteration: "wayn il-miftaaḥ", english: "where is the key" },
        },
      ],
      dialogue: [],
      sound_spotlight: [],
      lesson_sequence: [],
      real_world_prompts: [],
      video_needs: { queries: ["جولة في بيتنا"], channels: ["Moshaya Family"], scene: "A home tour." },
    },
  ],
};

const line = (over: Partial<SpeechLine>): SpeechLine => ({
  source: "discover_video",
  dialect: "Gulf",
  videoId: "vid1",
  videoTitle: "Morning routine",
  text: "",
  startMs: 61000,
  endMs: 63500,
  ...over,
});

describe("wordSurfaces", () => {
  it("normalises, de-duplicates and adds the definite form of every bare surface", () => {
    expect(wordSurfaces({ arabic: "ماي", variants: ["الماي", "مويه", "ماي", "مُويَه", "لو سمحت"] })).toEqual([
      { display: "ماي", norm: "ماي" },
      { display: "الماي", norm: "الماي" },
      { display: "مويه", norm: "مويه" },
      { display: "المويه", norm: "المويه" },
      { display: "لو سمحت", norm: "لو سمحت" },
    ]);
  });
});

describe("matchTranscripts", () => {
  it("matches whole words and variants on normalised text, in the line's own dialect only", () => {
    const hits = matchTranscripts([track], [
      line({ text: "شربت الماي كله" }),
      line({ text: "مُويَه باردة", source: "caption_line", videoId: "yt1" }),
      line({ text: "ماية ماية", dialect: "Egyptian" }),
      line({ text: "مايكل جاء" }),
      line({ text: "وين مفتاحي", videoId: "vid2" }),
      line({ text: "المفتاح هنا", source: "published_clip", videoId: "yt2" }),
      line({ text: "خذ الجوال وماي", videoId: "vid3" }),
    ]);
    expect(hits.map((h) => [h.arabic, h.surface, h.line.videoId])).toEqual([
      ["ماي", "الماي", "vid1"],
      ["ماي", "مويه", "yt1"],
      ["مفتاح", "المفتاح", "yt2"],
      ["ماي", "ماي", "vid3"],
    ]);
    expect(hits[0].lessonKey).toBe("gulf/s1/l01");
  });

  it("ignores lines for a dialect with no tracks and empty lines", () => {
    expect(matchTranscripts([track], [line({ dialect: "Yemeni", text: "ماي" }), line({ text: "   " })])).toEqual([]);
  });
});

describe("videoNeedsMarkdown", () => {
  it("lists the scene, channels, searches and every word's surfaces per lesson", () => {
    const md = videoNeedsMarkdown(syllabus, [track]);
    expect(md).toContain("# Video needs — Gulf");
    expect(md).toContain("## Stage 1 — Foundations (Pre-A1 → A1)");
    expect(md).toContain("### gulf/s1/l01 · Objects");
    expect(md).toContain("**Scene:** A home tour.");
    expect(md).toContain("**Syllabus guidance:** Objects named while shown.");
    expect(md).toContain("**Mine first:** Moshaya Family");
    expect(md).toContain("`جولة في بيتنا`");
    expect(md).toContain("| ماي | water | ماي، الماي، مويه، المويه | someone pouring water \\| with a pipe |");
    // No video hint → the image scene stands in.
    expect(md).toContain("| مفتاح | key | مفتاح، المفتاح | a key |");
  });
});

describe("coverageMarkdown", () => {
  it("reports hits per word with timestamps, caps the list, and lists what is still missing", () => {
    const hits = matchTranscripts([track], [
      ...Array.from({ length: 7 }, (_, i) => line({ text: `ماي ${i}`, videoId: `vid${i}` })),
    ]);
    const { markdown, summary } = coverageMarkdown([track], hits, "2026-09-05");
    expect(summary).toEqual({ dialect: "Gulf", words: 2, covered: 1, lines: 7 });
    expect(markdown.startsWith("# Video coverage — Gulf")).toBe(true);
    expect(markdown).toContain("**1 of 2 words** have at least one line in the library; 1 still need a video.");
    expect(markdown).toContain("**ماي** — water: 7 line(s)");
    expect(markdown).toContain("- [discover_video] Morning routine (vid0) 1:01–1:03: ماي 0");
    expect(markdown).toContain("- … and 2 more");
    expect(markdown).toContain("## Still to find\n\n- gulf/s1/l01 · مفتاح (key)");
  });

  it("says so when nothing is missing", () => {
    const hits = matchTranscripts([track], [line({ text: "ماي والمفتاح", startMs: null, endMs: null })]);
    const { markdown } = coverageMarkdown([track], hits, "2026-09-05");
    expect(markdown).toContain("Every word has at least one line in the library.");
    expect(markdown).toContain("?:??–?:??");
  });
});
