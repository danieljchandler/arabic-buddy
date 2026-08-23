import { describe, expect, it } from "vitest";
import {
  categoryLabel,
  groupClipsByCategory,
  UNGROUPED_CATEGORY,
  type ClipConcept,
  type PublishedClip,
} from "./clipLessons";

const concept = (over: Partial<ClipConcept>): ClipConcept => ({
  id: "c1",
  key: "dog",
  english_gloss: "dog",
  category: "animals",
  sort_order: 10,
  ...over,
});

const clip = (over: Partial<PublishedClip>): PublishedClip => ({
  id: "p1",
  concept_id: "c1",
  dialect: "Gulf",
  yt_video_id: "abc",
  start_ms: 0,
  end_ms: 3000,
  term: "كلب",
  term_gloss: "dog",
  arabic: "هذا كلب",
  translation: "This is a dog",
  transliteration: null,
  channel_name: null,
  ...over,
});

describe("groupClipsByCategory", () => {
  it("orders themes by the syllabus and hides concepts without clips", () => {
    const concepts = [
      concept({ id: "greet", key: "hello", category: "greetings_basics", sort_order: 1 }),
      concept({ id: "dog", key: "dog", category: "animals", sort_order: 40 }),
      // No clips: an A1 learner never sees an empty shelf.
      concept({ id: "cat", key: "cat", category: "animals", sort_order: 41 }),
    ];
    const clips = [
      clip({ id: "p-dog", concept_id: "dog" }),
      clip({ id: "p-greet", concept_id: "greet", term: "هلا" }),
    ];

    const grouped = groupClipsByCategory(concepts, clips);
    expect(grouped.map((g) => g.category)).toEqual(["greetings_basics", "animals"]);
    expect(grouped[1].concepts.map((c) => c.concept.key)).toEqual(["dog"]);
  });

  it("keeps several clips under one concept in input order", () => {
    const grouped = groupClipsByCategory(
      [concept({ id: "dog" })],
      [clip({ id: "newer", concept_id: "dog" }), clip({ id: "older", concept_id: "dog" })],
    );
    expect(grouped[0].concepts[0].clips.map((c) => c.id)).toEqual(["newer", "older"]);
  });

  it("collects orphaned clips into a trailing bucket instead of dropping them", () => {
    const grouped = groupClipsByCategory(
      [concept({ id: "dog" })],
      [clip({ concept_id: "dog" }), clip({ id: "orphan", concept_id: null, term: "قط", term_gloss: "cat" })],
    );
    const last = grouped[grouped.length - 1];
    expect(last.category).toBe(UNGROUPED_CATEGORY);
    expect(last.concepts[0].concept.english_gloss).toBe("cat");
    expect(last.concepts[0].clips[0].id).toBe("orphan");
  });

  it("returns nothing when there are no clips at all", () => {
    expect(groupClipsByCategory([concept({})], [])).toEqual([]);
  });
});

describe("categoryLabel", () => {
  it("labels known themes and humanizes unknown ones", () => {
    expect(categoryLabel("animals")).toBe("Animals");
    expect(categoryLabel("brand_new_theme")).toBe("brand new theme");
  });
});
