// Grouping logic for the learner clip player (/clips).
//
// published_clips rows are flat; the page reads as a syllabus: themes in
// seed order, concepts inside each theme in sort order, and only concepts
// that actually have clips — an A1 learner should never see an empty shelf.
// Clips whose concept was deleted (concept_id null) still deserve a home, so
// they gather under a trailing "More clips" theme rather than vanishing.

export interface ClipConcept {
  id: string;
  key: string;
  english_gloss: string;
  category: string;
  sort_order: number;
}

export interface PublishedClip {
  id: string;
  concept_id: string | null;
  dialect: string;
  yt_video_id: string;
  start_ms: number;
  end_ms: number;
  term: string;
  term_gloss: string | null;
  arabic: string;
  translation: string;
  transliteration: string | null;
  channel_name: string | null;
}

export interface ConceptWithClips {
  concept: ClipConcept;
  clips: PublishedClip[];
}

export interface ClipCategory {
  category: string;
  label: string;
  concepts: ConceptWithClips[];
}

/** Sentinel category for clips whose concept no longer exists. */
export const UNGROUPED_CATEGORY = "more_clips";

export const CATEGORY_LABELS: Record<string, string> = {
  greetings_basics: "Greetings & basics",
  people_family: "People & family",
  food_drink: "Food & drink",
  animals: "Animals",
  home_objects: "Home & objects",
  places: "Places",
  time_daily: "Time",
  descriptors: "Describing things",
  actions_daily: "Everyday verbs",
  question_words: "Question words",
  [UNGROUPED_CATEGORY]: "More clips",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replace(/_/g, " ");
}

/**
 * Themes in syllabus order, holding only concepts that have clips. Clip
 * order within a concept is preserved from the input (the page passes them
 * newest-first).
 */
export function groupClipsByCategory(
  concepts: ClipConcept[],
  clips: PublishedClip[],
): ClipCategory[] {
  const byConcept = new Map<string, PublishedClip[]>();
  const orphans: PublishedClip[] = [];
  for (const clip of clips) {
    if (!clip.concept_id) {
      orphans.push(clip);
      continue;
    }
    const list = byConcept.get(clip.concept_id) ?? [];
    list.push(clip);
    byConcept.set(clip.concept_id, list);
  }

  const ordered = [...concepts].sort((a, b) => a.sort_order - b.sort_order);
  const categories: ClipCategory[] = [];
  for (const concept of ordered) {
    const conceptClips = byConcept.get(concept.id);
    if (!conceptClips || conceptClips.length === 0) continue;
    let bucket = categories.find((c) => c.category === concept.category);
    if (!bucket) {
      bucket = { category: concept.category, label: categoryLabel(concept.category), concepts: [] };
      categories.push(bucket);
    }
    bucket.concepts.push({ concept, clips: conceptClips });
  }

  // Orphaned clips: real published content whose concept row went away.
  if (orphans.length > 0) {
    categories.push({
      category: UNGROUPED_CATEGORY,
      label: categoryLabel(UNGROUPED_CATEGORY),
      concepts: orphans.map((clip) => ({
        concept: {
          id: clip.id,
          key: clip.term,
          english_gloss: clip.term_gloss ?? clip.translation,
          category: UNGROUPED_CATEGORY,
          sort_order: Number.MAX_SAFE_INTEGER,
        },
        clips: [clip],
      })),
    });
  }

  return categories;
}
