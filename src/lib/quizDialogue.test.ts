import { describe, expect, it } from "vitest";
import { asDialogue, buildReplyQuestion, type DialogueLine } from "./quizDialogue";

/**
 * The reply question is the one step built from a conversation rather than
 * a word on its own, and it is built from the lesson's authored dialogue
 * rather than generated. What has to hold: the prompt is the line a person
 * actually said before the reply, no wrong option could also be right, and
 * the question declines rather than guesses when the dialogue cannot carry
 * it.
 */

const dialogue: DialogueLine[] = [
  { speaker: "Customer", arabic: "سمحلي، ماي لو سمحت", english: "Excuse me, water please" },
  { speaker: "Vendor", arabic: "أكيد. تفضل", english: "Sure. Here you go" },
  { speaker: "Customer", arabic: "مشكور", english: "Thanks" },
  { speaker: "Vendor", arabic: "العفو. شاي؟", english: "You're welcome. Tea?" },
  { speaker: "Customer", arabic: "لا، مشكور. وين الباب؟", english: "No, thanks. Where is the door?" },
  { speaker: "Vendor", arabic: "هذا الباب", english: "This is the door" },
];

describe("reading a dialogue", () => {
  it("keeps lines with Arabic and drops anything else", () => {
    expect(asDialogue([{ arabic: "أهلا" }, { arabic: "" }, { english: "hi" }, null, "x"])).toEqual([{ arabic: "أهلا" }]);
    expect(asDialogue(null)).toEqual([]);
    expect(asDialogue({ arabic: "أهلا" })).toEqual([]);
  });
});

describe("building the reply question", () => {
  it("uses the line before the word's line as the prompt", () => {
    const q = buildReplyQuestion(dialogue, "تفضل", "card-1");
    expect(q?.prompt.arabic).toBe("سمحلي، ماي لو سمحت");
    expect(q?.answer.arabic).toBe("أكيد. تفضل");
  });

  it("offers four replies, the right one among them, none of which also uses the word", () => {
    const q = buildReplyQuestion(dialogue, "مشكور", "card-1");
    expect(q).not.toBeNull();
    expect(q!.options).toHaveLength(4);
    expect(q!.options.filter((o) => o.arabic === q!.answer.arabic)).toHaveLength(1);
    // Two lines use مشكور; the second must not be offered as a wrong reply.
    expect(q!.options.map((o) => o.arabic)).not.toContain("لا، مشكور. وين الباب؟");
    // Nor the prompt itself.
    expect(q!.options.map((o) => o.arabic)).not.toContain(q!.prompt.arabic);
  });

  it("deals the same question for the same card", () => {
    expect(buildReplyQuestion(dialogue, "تفضل", "card-1")).toEqual(buildReplyQuestion(dialogue, "تفضل", "card-1"));
  });

  it("declines when the word opens the dialogue", () => {
    // Nobody said anything before it: there is no line to answer.
    expect(buildReplyQuestion(dialogue, "ماي", "card-1")).toBeNull();
  });

  it("declines when the word is not in the dialogue", () => {
    expect(buildReplyQuestion(dialogue, "سيارة", "card-1")).toBeNull();
  });

  it("tops up a short dialogue from other lines, and declines without enough", () => {
    const short: DialogueLine[] = [
      { arabic: "وين الباب؟", english: "Where is the door?" },
      { arabic: "هذا الباب", english: "This is the door" },
    ];
    expect(buildReplyQuestion(short, "هذا", "card-1")).toBeNull();
    const extra: DialogueLine[] = [{ arabic: "أكيد" }, { arabic: "مشكور" }, { arabic: "شاي؟" }];
    const q = buildReplyQuestion(short, "هذا", "card-1", extra);
    expect(q?.options).toHaveLength(4);
  });

  it("matches the word as a whole token, in any spelling", () => {
    expect(buildReplyQuestion(dialogue, "الباب", "card-1")?.answer.arabic).toBe("لا، مشكور. وين الباب؟");
    expect(buildReplyQuestion(dialogue, "باب", "card-1")).toBeNull();
  });
});
