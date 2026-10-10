import { describe, expect, it } from "vitest";
import { storyGap } from "./quizStory";
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
    const gap = storyGap(line([morning, ordered]), "قهوة", "coffee")!;
    expect(gap.gap).toBe(1);
    expect(gap.before).toBe("طلب الريال ");
    expect(gap.after).toBe(" حارة.");
    expect(gap.text).toBe(`${morning.arabic} ${ordered.arabic}`);
    expect(gap.text.slice(gap.span.start, gap.span.end)).toBe("قهوة");
    expect(gap.english).toBe("The morning was very cold. The man ordered hot coffee.");
    expect(gap.title).toBeNull();
  });

  it("finds the gap in the first sentence too", () => {
    const gap = storyGap(line([ordered, morning]), "قهوة", "coffee")!;
    expect(gap.gap).toBe(0);
    expect(gap.text.slice(gap.span.start, gap.span.end)).toBe("قهوة");
  });

  it("leaves a word's attached punctuation in the sentence", () => {
    const gap = storyGap(line([morning, { arabic: "طلب الريال قهوة.", english: "He ordered coffee." }]), "قهوة", "coffee")!;
    expect(gap.after).toBe(".");
  });

  it("cuts a phrase whole", () => {
    const daily = { arabic: "نشرب قهوة كل يوم الصبح.", english: "We drink coffee every morning." };
    const gap = storyGap(line([morning, daily], undefined, "كل يوم"), "كل يوم", "every day")!;
    expect(gap.text.slice(gap.span.start, gap.span.end)).toBe("كل يوم");
    expect(gap.before).toBe("نشرب قهوة ");
  });

  it("matches the word through its harakat", () => {
    const gap = storyGap(line([morning, ordered], undefined, "قَهْوَة"), "قَهْوَة", "coffee")!;
    expect(gap.text.slice(gap.span.start, gap.span.end)).toBe("قهوة");
  });

  it("names the story it was taken from", () => {
    expect(storyGap(line([morning, ordered], { id: "s", title: "The cold morning", titleArabic: "الصبح البارد" }), "قهوة", "coffee")?.title).toBe(
      "The cold morning",
    );
    expect(storyGap(line([morning, ordered], { id: "s", title: "", titleArabic: "الصبح البارد" }), "قهوة", "coffee")?.title).toBe("الصبح البارد");
  });

  it("does not name a story whose title says the word", () => {
    expect(storyGap(line([morning, ordered], { id: "s", title: "", titleArabic: "بياع القهوة" }), "قهوة", "coffee")?.title).toBeNull();
  });

  it("does not name a story whose title names what the word means", () => {
    // The four-option gap withholds the meaning: "At the Market" above a gap
    // for السوق would name the answer above its choices.
    const atTheMarket = { arabic: "رحنا السوق الصبح.", english: "We went to the market in the morning." };
    const market = (title: string, english: string) =>
      storyGap(line([morning, atTheMarket], { id: "s", title, titleArabic: "" }, "السوق"), "السوق", english)?.title;
    expect(market("At the Market", "market")).toBeNull();
    expect(market("At the Market", "the market")).toBeNull();
    expect(market("Markets of the Gulf", "Market")).toBeNull();
    // Folded as the key folds a sense, and each meaning a gloss lists counts.
    expect(market("At the Market", "market / souq")).toBeNull();
    expect(market("The Old Souq", "market, souq")).toBeNull();
    expect(market("At the Market", "market (place)")).toBeNull();
    // A title about something else is still shown.
    expect(market("The cold morning", "market")).toBe("The cold morning");
    expect(storyGap(line([morning, ordered], { id: "s", title: "Coffee at dawn", titleArabic: "" }), "قهوة", "coffee")?.title).toBeNull();
  });

  it("is no gap without a passage", () => {
    expect(storyGap(null, "قهوة", "coffee")).toBeNull();
    expect(storyGap(undefined, "قهوة", "coffee")).toBeNull();
  });
});
