import { describe, it, expect } from "vitest";
import {
  classifyRows,
  dedupe,
  onScreenVocabBlock,
  renderProfileForPrompt,
  sample,
  MATURE_INTERVAL_DAYS,
  type LearnerProfile,
  type ScheduleRow,
} from "../../supabase/functions/_shared/learnerProfileCore";

const row = (over: Partial<ScheduleRow> = {}): ScheduleRow => ({
  arabic: "بيت",
  english: "house",
  intervalDays: 30,
  repetitions: 5,
  lapses: 0,
  isLeech: false,
  ...over,
});

describe("classifyRows", () => {
  it("treats a well-spaced, reviewed card as known", () => {
    const { known, learning, weak } = classifyRows([row()]);
    expect(known).toEqual([{ arabic: "بيت", english: "house" }]);
    expect(learning).toHaveLength(0);
    expect(weak).toHaveLength(0);
  });

  it("treats a never-reviewed card as learning even with a long interval", () => {
    // repetitions === 0 means the interval is a default, not an earned schedule.
    const { known, learning } = classifyRows([row({ repetitions: 0, intervalDays: 30 })]);
    expect(known).toHaveLength(0);
    expect(learning).toHaveLength(1);
  });

  it("treats a short interval as learning", () => {
    const { known, learning } = classifyRows([
      row({ intervalDays: MATURE_INTERVAL_DAYS - 1 }),
    ]);
    expect(known).toHaveLength(0);
    expect(learning).toHaveLength(1);
  });

  it("marks a leech weak while still counting it in the lexicon", () => {
    const { known, weak } = classifyRows([row({ isLeech: true })]);
    expect(known).toHaveLength(1);
    expect(weak).toHaveLength(1);
  });

  it("marks repeat lapses weak", () => {
    const { weak } = classifyRows([row({ lapses: 2 })]);
    expect(weak).toHaveLength(1);
  });

  it("does not mark a single lapse weak", () => {
    const { weak } = classifyRows([row({ lapses: 1 })]);
    expect(weak).toHaveLength(0);
  });

  it("marks a word weak from a production error even on a comfortable schedule", () => {
    // The case SRS state alone cannot see: recognised reliably, but the learner
    // cannot actually say it.
    const { known, weak } = classifyRows([row()], new Set(["بيت"]));
    expect(known).toHaveLength(1);
    expect(weak).toEqual([{ arabic: "بيت", english: "house" }]);
  });

  it("treats null lapses/isLeech as unknown rather than as struggling", () => {
    // word_reviews rows carry neither field; they must not all come back weak.
    const { weak } = classifyRows([row({ lapses: null, isLeech: null })]);
    expect(weak).toHaveLength(0);
  });

  it("skips rows missing either side of the pair", () => {
    const { known, learning, weak } = classifyRows([
      row({ arabic: null }),
      row({ english: "  " }),
      row({ arabic: "" }),
    ]);
    expect([...known, ...learning, ...weak]).toHaveLength(0);
  });

  it("trims surrounding whitespace", () => {
    const { known } = classifyRows([row({ arabic: " بيت ", english: " house " })]);
    expect(known).toEqual([{ arabic: "بيت", english: "house" }]);
  });

  it("deduplicates a word present in both decks", () => {
    const { known } = classifyRows([row(), row()]);
    expect(known).toHaveLength(1);
  });

  it("does not put the same word in both known and learning", () => {
    // The same word can sit in both decks at different maturities. Without the
    // cross-bucket filter the prompt would tell the model a word is
    // simultaneously mastered and in need of reinforcement.
    const { known, learning } = classifyRows([
      row({ intervalDays: 30, repetitions: 5 }),
      row({ intervalDays: 1, repetitions: 0 }),
    ]);
    expect(known.map((w) => w.arabic)).toEqual(["بيت"]);
    expect(learning).toHaveLength(0);
  });

  it("filters the overlap even when the immature row comes first", () => {
    const { known, learning } = classifyRows([
      row({ intervalDays: 1, repetitions: 0 }),
      row({ intervalDays: 30, repetitions: 5 }),
    ]);
    expect(known.map((w) => w.arabic)).toEqual(["بيت"]);
    expect(learning).toHaveLength(0);
  });
});

describe("dedupe", () => {
  it("keeps first occurrence order", () => {
    expect(
      dedupe([
        { arabic: "a", english: "1" },
        { arabic: "b", english: "2" },
        { arabic: "a", english: "3" },
      ]),
    ).toEqual([
      { arabic: "a", english: "1" },
      { arabic: "b", english: "2" },
    ]);
  });
});

describe("sample", () => {
  it("returns everything when under budget", () => {
    expect(sample([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it("returns nothing for a zero budget", () => {
    expect(sample([1, 2, 3], 0)).toEqual([]);
  });

  it("keeps the head deterministically and fills the rest from the tail", () => {
    // rng() === 0 makes the shuffle deterministic so the head bias is testable.
    const out = sample([1, 2, 3, 4, 5, 6], 4, () => 0);
    expect(out).toHaveLength(4);
    expect(out.slice(0, 2)).toEqual([1, 2]);
    expect(new Set(out).size).toBe(4);
  });

  it("never returns more than the budget", () => {
    for (let n = 1; n <= 10; n++) {
      expect(sample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], n).length).toBe(n);
    }
  });
});

const profile = (over: Partial<LearnerProfile> = {}): LearnerProfile => ({
  userId: "u1",
  dialect: "Gulf",
  dialectLabel: "Gulf Arabic",
  level: "A2",
  reason: null,
  interests: [],
  known: [{ arabic: "بيت", english: "house" }],
  learning: [],
  weak: [],
  knownTotal: 1,
  weakGrammar: [],
  ...over,
});

describe("renderProfileForPrompt", () => {
  it("returns an empty string for a learner we know nothing about", () => {
    // Callers concatenate unconditionally, so a cold-start user must add nothing.
    const out = renderProfileForPrompt(
      profile({ level: null, known: [], knownTotal: 0 }),
    );
    expect(out).toBe("");
  });

  it("includes level, lexicon size and known words", () => {
    const out = renderProfileForPrompt(profile());
    expect(out).toContain("CEFR level: A2");
    expect(out).toContain("roughly 1 words");
    expect(out).toContain("بيت (house)");
    expect(out).toContain("Gulf Arabic");
  });

  it("omits the weak list when includeWeak is false", () => {
    const p = profile({ weak: [{ arabic: "شغل", english: "work" }] });
    expect(renderProfileForPrompt(p)).toContain("شغل (work)");
    expect(renderProfileForPrompt(p, { includeWeak: false })).not.toContain("شغل (work)");
  });

  it("omits reason and interests when includeInterests is false", () => {
    const p = profile({ reason: "working in Dubai", interests: ["food"] });
    expect(renderProfileForPrompt(p)).toContain("working in Dubai");
    const without = renderProfileForPrompt(p, { includeInterests: false });
    expect(without).not.toContain("working in Dubai");
    expect(without).not.toContain("food");
  });

  it("tells the model not to leak the profile into the output", () => {
    expect(renderProfileForPrompt(profile())).toContain("Never list these words");
  });

  const shaky = {
    conceptKey: "negation",
    label: "Negation",
    exposures: 8,
    correct: 2,
    incorrect: 6,
    ease: 2.1,
    strength: "learning" as const,
    nextDueAt: null,
    lastSeenAt: null,
  };

  it("names weak grammar separately from weak vocabulary", () => {
    const out = renderProfileForPrompt(
      profile({ weak: [{ arabic: "شغل", english: "work" }], weakGrammar: [shaky] }),
    );
    // Two different problems: a shaky word wants another exposure, a shaky
    // structure wants the correct form modelled. They must not share a line.
    expect(out).toContain("Negation (25% correct over 8 attempts)");
    const grammarLine = out.split("\n").find((l) => l.includes("Negation"));
    expect(grammarLine).not.toContain("شغل");
  });

  it("says nothing about grammar the learner has never got wrong", () => {
    const solid = { ...shaky, conceptKey: "pronouns", label: "Pronouns", correct: 8, incorrect: 0 };
    expect(renderProfileForPrompt(profile({ weakGrammar: [solid] }))).not.toContain("Pronouns");
  });

  it("omits weak grammar when includeWeak is false", () => {
    const p = profile({ weakGrammar: [shaky] });
    expect(renderProfileForPrompt(p)).toContain("Negation");
    expect(renderProfileForPrompt(p, { includeWeak: false })).not.toContain("Negation");
  });
});

describe("onScreenVocabBlock", () => {
  const membership = {
    known: ["بيت", "سوق"],
    learning: ["قهوة"],
    weak: ["شغل"],
  };

  it("sorts the on-screen words into the learner's real buckets", () => {
    const out = onScreenVocabBlock(membership, [
      { arabic: "شغل", english: "work" },
      { arabic: "قهوة", english: "coffee" },
      { arabic: "بيت", english: "house" },
      { arabic: "تمر", english: "dates" },
    ]);
    // Each word lands under its own heading — the whole point is that
    // "of the words on screen, these are due work" stops being a guess.
    const lineWith = (word: string) => out.split("\n").find((l) => l.includes(word)) ?? "";
    expect(lineWith("شغل")).toContain("FAILING");
    expect(lineWith("قهوة")).toContain("LEARNING");
    expect(lineWith("بيت")).toContain("KNOW");
    expect(lineWith("تمر")).toContain("NEW");
  });

  it("matches through the definite article and diacritics", () => {
    // The deck stores سوق; a subtitle shows السُّوق. That pair failing to
    // match is the common case this exists for, not a corner one.
    const out = onScreenVocabBlock(membership, [{ arabic: "السُّوق", english: "the market" }]);
    expect(out.split("\n").find((l) => l.includes("السُّوق"))).toContain("KNOW");
    expect(out).not.toContain("NEW");
  });

  it("prefers weak over known when both decks carry the word", () => {
    const both = { known: ["شغل"], learning: [], weak: ["شغل"] };
    const out = onScreenVocabBlock(both, [{ arabic: "شغل", english: "work" }]);
    // A leech with a comfortable sibling entry is still the thing to call out.
    expect(out).toContain("FAILING");
    expect(out).not.toContain("KNOW these well");
  });

  it("says nothing without membership data or on-screen vocabulary", () => {
    expect(onScreenVocabBlock(undefined, [{ arabic: "بيت" }])).toBe("");
    expect(onScreenVocabBlock(membership, [])).toBe("");
    expect(onScreenVocabBlock(membership, undefined)).toBe("");
  });

  it("dedupes repeats and caps each list", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ arabic: `كلمة${i}` }));
    const out = onScreenVocabBlock(membership, [
      { arabic: "بيت" },
      { arabic: "البيت" },
      ...many,
    ]);
    // One entry for the بيت pair, and the NEW list stays bounded.
    expect(out.match(/بيت/g)).toHaveLength(1);
    expect((out.match(/كلمة/g) ?? []).length).toBeLessThanOrEqual(10);
  });
});

// ── Chunks (formulaic sequences) ─────────────────────────────────────────────

import { classifyChunks, type ChunkScheduleRow } from "../../supabase/functions/_shared/learnerProfileCore";

const chunkRow = (over: Partial<ChunkScheduleRow> = {}): ChunkScheduleRow => ({
  arabic: "الله يعطيك العافية",
  english: "may God give you strength",
  intervalDays: 30,
  repetitions: 5,
  productionNextReviewAt: null,
  ...over,
});

describe("classifyChunks", () => {
  const NOW = new Date("2026-09-01T12:00:00.000Z");

  it("treats a mature recognition schedule as a known chunk", () => {
    const { known, due } = classifyChunks([chunkRow()], NOW);
    expect(known).toHaveLength(1);
    expect(due).toHaveLength(0);
  });

  it("keeps an immature, not-due chunk out of both lists", () => {
    // Half-learned and not yet asked for: telling the model anything about it
    // would be claiming knowledge the schedule doesn't show.
    const { known, due } = classifyChunks(
      [chunkRow({ intervalDays: 2, repetitions: 1 })],
      NOW,
    );
    expect(known).toHaveLength(0);
    expect(due).toHaveLength(0);
  });

  it("flags a chunk due on the speaking track", () => {
    const { due } = classifyChunks(
      [chunkRow({ productionNextReviewAt: "2026-09-01T11:00:00.000Z" })],
      NOW,
    );
    expect(due).toHaveLength(1);
  });

  it("puts a mature chunk that is due for speaking in due only", () => {
    // "Invite this" and "you know this" about the same phrase would be
    // contradictory instructions; the invitation wins.
    const { known, due } = classifyChunks(
      [chunkRow({ productionNextReviewAt: "2026-09-01T11:00:00.000Z" })],
      NOW,
    );
    expect(due).toHaveLength(1);
    expect(known).toHaveLength(0);
  });

  it("ignores a speaking date still in the future", () => {
    const { known, due } = classifyChunks(
      [chunkRow({ productionNextReviewAt: "2026-09-09T11:00:00.000Z" })],
      NOW,
    );
    expect(due).toHaveLength(0);
    expect(known).toHaveLength(1);
  });

  it("dedupes on the Arabic surface form", () => {
    const { known } = classifyChunks([chunkRow(), chunkRow()], NOW);
    expect(known).toHaveLength(1);
  });
});

describe("rendering chunks into the prompt", () => {
  it("tells the model to reuse drilled chunks verbatim", () => {
    const out = renderProfileForPrompt(
      profile({ chunks: [{ arabic: "شخبارك", english: "how are you" }] }),
    );
    expect(out).toContain("شخبارك (how are you)");
    expect(out).toContain("verbatim");
  });

  it("asks for openings for chunks due on the speaking track", () => {
    const out = renderProfileForPrompt(
      profile({ dueChunks: [{ arabic: "الله يعطيك العافية", english: "may God give you strength" }] }),
    );
    // The teddy-bear counterweight: due chunks get a deliberate invitation.
    expect(out).toContain("الله يعطيك العافية");
    expect(out).toContain("invites");
  });

  it("keeps due chunks out of the prompt when includeWeak is off", () => {
    const p = profile({ dueChunks: [{ arabic: "يلا نروح", english: "let's go" }] });
    expect(renderProfileForPrompt(p, { includeWeak: false })).not.toContain("يلا نروح");
  });

  it("stays silent for a learner with no chunk deck", () => {
    expect(renderProfileForPrompt(profile())).not.toContain("CHUNKS");
  });
});
