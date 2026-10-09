import { describe, expect, it } from "vitest";
import {
  asDialogue,
  buildReplyQuestion,
  countWrongReplies,
  dialogueForWord,
  findPhraseSpan,
  findReplyLine,
  type DialogueLine,
} from "./quizDialogue";

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

describe("the word's exchange from the store", () => {
  // `kind: "dialogue"` in the shared store: two lines, the second using the
  // word, made once per word and dialect when its lesson has no line for it.
  const stored = {
    lines: [
      { speaker: "Friend", arabic: "تبي شي تشربه؟", english: "Want something to drink?", transliteration: "" },
      { speaker: "Guest", arabic: "ايه، عطني قهوة", english: "Yes, give me coffee", transliteration: "" },
    ],
  };

  it("prefers the lesson's dialogue when a line of it uses the word", () => {
    expect(dialogueForWord(dialogue, stored, "تفضل")).toEqual({ lines: dialogue, source: "lesson" });
  });

  it("falls back to the stored exchange when the lesson has no line for the word", () => {
    for (const lesson of [dialogue, null, [], "not a dialogue"]) {
      expect(dialogueForWord(lesson, stored, "قهوة"), JSON.stringify(lesson)).toEqual({
        lines: stored.lines,
        source: "store",
      });
    }
  });

  it("has nothing when neither uses the word", () => {
    expect(dialogueForWord(dialogue, stored, "سيارة")).toBeNull();
    expect(dialogueForWord(null, null, "قهوة")).toBeNull();
    // A stored exchange whose reply is about another word is no question about this one.
    expect(dialogueForWord(null, stored, "شاي")).toBeNull();
  });

  it("finds the line said and the reply that uses the word", () => {
    expect(findReplyLine(stored.lines, "قهوة")).toEqual({ prompt: stored.lines[0], answer: stored.lines[1] });
    expect(findReplyLine(stored.lines, "تشربه")).toBeNull();
  });

  it("asks the stored reply with wrong replies from other words' stored replies", () => {
    const others: DialogueLine[] = [
      { arabic: "ايه، الحين جاي" },
      { arabic: "لا والله ما ادري" },
      { arabic: "تمام، نشوفك بكره" },
      // Another word's reply that happens to use this word too: never a wrong one.
      { arabic: "القهوة زينة، عطني قهوة" },
    ];
    const q = buildReplyQuestion(dialogueForWord(null, stored, "قهوة")!.lines, "قهوة", "card-1", others);
    expect(q?.prompt.arabic).toBe("تبي شي تشربه؟");
    expect(q?.answer.arabic).toBe("ايه، عطني قهوة");
    expect(q?.options).toHaveLength(4);
    expect(q!.options.map((o) => o.arabic)).not.toContain("القهوة زينة، عطني قهوة");
  });

  it("cannot ask the choice without three other replies, though the reply can still be said", () => {
    const lines = dialogueForWord(null, stored, "قهوة")!.lines;
    expect(buildReplyQuestion(lines, "قهوة", "card-1", [{ arabic: "ايه، الحين جاي" }])).toBeNull();
    expect(findReplyLine(lines, "قهوة")).not.toBeNull();
  });

  it("counts the wrong replies a question could deal before it is built", () => {
    const lines: DialogueLine[] = [
      { arabic: "ايه، الحين جاي" },
      { arabic: "ايه، الحين جاي " },
      { arabic: "عطني قهوة" },
      { arabic: "تبي شي تشربه؟" },
    ];
    expect(countWrongReplies(lines, "قهوة")).toBe(2);
    expect(countWrongReplies(lines, "قهوة", [stored.lines[0]])).toBe(1);
  });
});

describe("a word of more than one word", () => {
  // A fifth of the curriculum's items are phrases (كل يوم, يعطيك العافية).
  // The store files an exchange whose reply uses the phrase as a run of
  // words, so the quiz must read "uses the word" the same way, or it would
  // pay for an exchange it can never ask from.
  const stored = {
    lines: [
      { speaker: "Friend", arabic: "متى تشرب قهوة؟", english: "When do you drink coffee?", transliteration: "" },
      { speaker: "You", arabic: "اشرب قهوة كل يوم الصبح", english: "I drink coffee every morning", transliteration: "" },
    ],
  };

  it("asks the reply from a stored exchange that uses the phrase", () => {
    const chosen = dialogueForWord(null, stored, "كل يوم");
    expect(chosen?.source).toBe("store");
    expect(findReplyLine(chosen!.lines, "كل يوم")?.answer.arabic).toBe("اشرب قهوة كل يوم الصبح");
    const q = buildReplyQuestion(chosen!.lines, "كل يوم", "card-1", [
      { arabic: "ما ادري" },
      { arabic: "بعدين" },
      { arabic: "كل شي تمام" },
      // Uses the phrase too: never a wrong reply.
      { arabic: "اشوفك كل يوم" },
    ]);
    expect(q?.options).toHaveLength(4);
    expect(q!.options.map((o) => o.arabic)).not.toContain("اشوفك كل يوم");
  });

  it("asks a lesson's line that uses the phrase", () => {
    expect(findReplyLine(stored.lines, "كل يوم")).not.toBeNull();
    // The words apart, or in another order, are not the phrase.
    expect(findReplyLine([stored.lines[0], { arabic: "يوم كل" }], "كل يوم")).toBeNull();
  });

  it("cuts a gap around the whole phrase, and around a single word as before", () => {
    const line = "اشرب قهوة كل يوم، الصبح";
    const span = findPhraseSpan(line, "كل يوم")!;
    expect(line.slice(span.start, span.end)).toBe("كل يوم");
    const single = findPhraseSpan(line, "قهوة")!;
    expect(line.slice(single.start, single.end)).toBe("قهوة");
    expect(findPhraseSpan(line, "كل شهر")).toBeNull();
  });
});
