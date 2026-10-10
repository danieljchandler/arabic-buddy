import { describe, expect, it } from "vitest";
import { storyGap, whyNotQuestion } from "./quizStory";
import { asStoredStoryLine } from "../../supabase/functions/_shared/wordStoryLine";

/**
 * Cutting the gap in a word's story passage (quiz Phase 6). The gap must cut
 * the word's whole span and nothing else — a phrase whole, punctuation left
 * in place — and say where it is in the passage as read aloud, so the muted
 * reading mutes exactly the word.
 */

const morning = { arabic: "كان الصبح بارد وايد.", english: "The morning was very cold." };
const ordered = { arabic: "طلب الريال قهوة حارة.", english: "The man ordered hot coffee." };
const line = (sentences: unknown[], story?: unknown, word = "قهوة") =>
  asStoredStoryLine({ sentences, ...(story ? { story } : {}) }, word);

describe("storyGap", () => {
  it("cuts the word out of its sentence, and finds it in the passage as read aloud", () => {
    const gap = storyGap(line([morning, ordered]), "قهوة")!;
    expect(gap.gap).toBe(1);
    expect(gap.before).toBe("طلب الريال ");
    expect(gap.after).toBe(" حارة.");
    expect(gap.text).toBe(`${morning.arabic} ${ordered.arabic}`);
    expect(gap.text.slice(gap.span.start, gap.span.end)).toBe("قهوة");
    expect(gap.english).toBe("The morning was very cold. The man ordered hot coffee.");
    expect(gap.title).toBeNull();
  });

  it("finds the gap in the first sentence too", () => {
    const gap = storyGap(line([ordered, morning]), "قهوة")!;
    expect(gap.gap).toBe(0);
    expect(gap.text.slice(gap.span.start, gap.span.end)).toBe("قهوة");
  });

  it("leaves a word's attached punctuation in the sentence", () => {
    const gap = storyGap(line([morning, { arabic: "طلب الريال قهوة.", english: "He ordered coffee." }]), "قهوة")!;
    expect(gap.after).toBe(".");
  });

  it("cuts a phrase whole", () => {
    const daily = { arabic: "نشرب قهوة كل يوم الصبح.", english: "We drink coffee every morning." };
    const gap = storyGap(line([morning, daily], undefined, "كل يوم"), "كل يوم")!;
    expect(gap.text.slice(gap.span.start, gap.span.end)).toBe("كل يوم");
    expect(gap.before).toBe("نشرب قهوة ");
  });

  it("matches the word through its harakat", () => {
    const gap = storyGap(line([morning, ordered], undefined, "قَهْوَة"), "قَهْوَة")!;
    expect(gap.text.slice(gap.span.start, gap.span.end)).toBe("قهوة");
  });

  it("names the story it was taken from", () => {
    expect(storyGap(line([morning, ordered], { id: "s", title: "The cold morning", titleArabic: "الصبح البارد" }), "قهوة")?.title).toBe(
      "The cold morning",
    );
    expect(storyGap(line([morning, ordered], { id: "s", title: "", titleArabic: "الصبح البارد" }), "قهوة")?.title).toBe("الصبح البارد");
  });

  it("does not name a story whose title says the word", () => {
    expect(storyGap(line([morning, ordered], { id: "s", title: "", titleArabic: "بياع القهوة" }), "قهوة")?.title).toBeNull();
  });

  it("is no gap without a passage", () => {
    expect(storyGap(null, "قهوة")).toBeNull();
    expect(storyGap(undefined, "قهوة")).toBeNull();
  });
});

describe("whyNotQuestion", () => {
  it("puts the pair to the tutor, about this gap", () => {
    expect(whyNotQuestion({ picked: "شاي", answer: "قهوة", meaning: "coffee" })).toBe(
      'In this passage I put «شاي» in the gap, but the word is «قهوة» ("coffee"). Why doesn\'t «شاي» fit here?',
    );
  });
});
