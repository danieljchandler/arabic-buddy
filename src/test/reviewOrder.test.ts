import { describe, it, expect } from "vitest";
import {
  buildReviewOrder,
  interleaveDirections,
  isNewCard,
  recognitionChannel,
  type CardDirection,
  type SchedulableCard,
  BEGINNER_REVIEW_THRESHOLD,
} from "@/lib/reviewOrder";

interface TestCard extends SchedulableCard {
  id: string;
}

const card = (
  id: string,
  card_type: CardDirection,
  repetitions: number,
  due_at = "2026-01-01T00:00:00Z",
): TestCard => ({ id, card_type, repetitions, due_at });

const ids = (cards: TestCard[]) => cards.map((c) => c.id);

describe("isNewCard", () => {
  it("treats zero repetitions as new", () => {
    expect(isNewCard(card("a", "recognition", 0))).toBe(true);
    expect(isNewCard(card("a", "recognition", 1))).toBe(false);
  });
});

describe("interleaveDirections", () => {
  it("alternates two directions", () => {
    const out = interleaveDirections([
      card("r1", "recognition", 1),
      card("r2", "recognition", 1),
      card("p1", "production", 1),
      card("p2", "production", 1),
    ]);
    expect(ids(out)).toEqual(["r1", "p1", "r2", "p2"]);
  });

  it("round-robins three directions", () => {
    const out = interleaveDirections([
      card("r1", "recognition", 1),
      card("p1", "production", 1),
      card("a1", "audio", 1),
    ]);
    expect(ids(out)).toEqual(["r1", "p1", "a1"]);
  });

  it("appends the remainder when directions are uneven", () => {
    const out = interleaveDirections([
      card("r1", "recognition", 1),
      card("r2", "recognition", 1),
      card("r3", "recognition", 1),
      card("p1", "production", 1),
    ]);
    expect(ids(out)).toEqual(["r1", "p1", "r2", "r3"]);
  });

  it("passes a single direction through unchanged", () => {
    const input = [card("r1", "recognition", 1), card("r2", "recognition", 1)];
    expect(ids(interleaveDirections(input))).toEqual(["r1", "r2"]);
  });

  it("handles an empty list", () => {
    expect(interleaveDirections([])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [
      card("r1", "recognition", 1),
      card("p1", "production", 1),
      card("r2", "recognition", 1),
    ];
    const before = ids(input);
    interleaveDirections(input);
    expect(ids(input)).toEqual(before);
  });
});

describe("buildReviewOrder", () => {
  it("caps new cards but never caps reviews", () => {
    const cards = [
      card("n1", "recognition", 0),
      card("n2", "recognition", 0),
      card("n3", "recognition", 0),
      card("v1", "recognition", 3),
      card("v2", "recognition", 3),
      card("v3", "recognition", 3),
      card("v4", "recognition", 3),
    ];
    const out = buildReviewOrder(cards, { newCardCap: 1 });
    expect(out.filter(isNewCard)).toHaveLength(1);
    expect(out.filter((c) => !isNewCard(c))).toHaveLength(4);
  });

  it("admits no new cards when the budget is spent", () => {
    // The daily new-card budget is server-persisted and can reach zero mid-day;
    // a session must then be reviews only, not silently fall back to uncapped.
    const out = buildReviewOrder(
      [card("n1", "recognition", 0), card("v1", "recognition", 2)],
      { newCardCap: 0 },
    );
    expect(ids(out)).toEqual(["v1"]);
  });

  it("clamps a negative cap to zero rather than slicing from the end", () => {
    const out = buildReviewOrder([card("n1", "recognition", 0)], { newCardCap: -3 });
    expect(out).toEqual([]);
  });

  it("leads with a review card and interleaves new ones after", () => {
    const out = buildReviewOrder(
      [
        card("n1", "recognition", 0),
        card("n2", "recognition", 0),
        card("v1", "recognition", 2),
        card("v2", "recognition", 2),
      ],
      { newCardCap: 10 },
    );
    expect(ids(out)).toEqual(["v1", "n1", "v2", "n2"]);
  });

  it("prioritises the most overdue cards", () => {
    const out = buildReviewOrder(
      [
        card("late", "recognition", 2, "2026-01-03T00:00:00Z"),
        card("latest", "recognition", 2, "2026-01-01T00:00:00Z"),
        card("middle", "recognition", 2, "2026-01-02T00:00:00Z"),
      ],
      { newCardCap: 0 },
    );
    expect(ids(out)).toEqual(["latest", "middle", "late"]);
  });

  it("treats the same instant as equal across timestamp serialisations", () => {
    // Postgres returns "…+00:00"; JS toISOString() returns "…Z". Both reach
    // due_at. These two are the SAME instant, so the sort must be a no-op and
    // input order must survive — the timestamps have to be identical for this
    // to test anything, because any real difference orders them the same way
    // under both comparators.
    //
    // Under localeCompare, '+' (0x2B) sorts before 'Z' (0x5A), so the offset
    // form would jump ahead of an equal instant. That's the regression.
    const out = buildReviewOrder(
      [
        card("zulu", "recognition", 2, "2026-01-01T00:00:00Z"),
        card("offset", "recognition", 2, "2026-01-01T00:00:00+00:00"),
      ],
      { newCardCap: 0 },
    );
    expect(ids(out)).toEqual(["zulu", "offset"]);
  });

  it("orders a non-UTC offset by its instant, not its wall clock", () => {
    // 09:00+05:00 is 04:00Z — earlier than 06:00Z despite the larger local hour.
    const out = buildReviewOrder(
      [
        card("later", "recognition", 2, "2026-01-01T06:00:00Z"),
        card("earlier", "recognition", 2, "2026-01-01T09:00:00+05:00"),
      ],
      { newCardCap: 0 },
    );
    expect(ids(out)).toEqual(["earlier", "later"]);
  });

  it("mixes directions rather than blocking them", () => {
    const out = buildReviewOrder(
      [
        card("r1", "recognition", 2),
        card("r2", "recognition", 2),
        card("p1", "production", 2),
        card("p2", "production", 2),
        card("a1", "audio", 2),
        card("a2", "audio", 2),
      ],
      { newCardCap: 0 },
    );
    // No direction should appear twice in a row anywhere in the session.
    const types = out.map((c) => c.card_type);
    for (let i = 1; i < types.length; i++) {
      expect(types[i]).not.toBe(types[i - 1]);
    }
  });

  it("keeps every review card and drops only capped new cards", () => {
    const cards = [
      ...Array.from({ length: 5 }, (_, i) => card(`n${i}`, "production", 0)),
      ...Array.from({ length: 7 }, (_, i) => card(`v${i}`, "recognition", 4)),
    ];
    const out = buildReviewOrder(cards, { newCardCap: 2 });
    expect(out).toHaveLength(9);
    expect(new Set(ids(out)).size).toBe(9);
  });

  it("handles an empty deck", () => {
    expect(buildReviewOrder([], { newCardCap: 5 })).toEqual([]);
  });

  it("does not mutate or reorder its input array", () => {
    const input = [
      card("b", "recognition", 2, "2026-01-02T00:00:00Z"),
      card("a", "recognition", 2, "2026-01-01T00:00:00Z"),
    ];
    buildReviewOrder(input, { newCardCap: 0 });
    expect(ids(input)).toEqual(["b", "a"]);
  });
});

describe("buildReviewOrder — blocked new cards for beginners", () => {
  // Reviews r1..r3 are due before the new cards; new cards n1 (recognition),
  // n2 (production), n3 (recognition) are all due later.
  const deck = () => [
    card("n1", "recognition", 0, "2026-01-10T00:00:00Z"),
    card("n2", "production", 0, "2026-01-11T00:00:00Z"),
    card("n3", "recognition", 0, "2026-01-12T00:00:00Z"),
    card("r1", "recognition", 3, "2026-01-01T00:00:00Z"),
    card("r2", "production", 2, "2026-01-02T00:00:00Z"),
    card("r3", "recognition", 4, "2026-01-03T00:00:00Z"),
  ];

  it("keeps the default shape when the flag is off", () => {
    const order = buildReviewOrder(deck(), { newCardCap: 10 });
    // Reviews and new cards alternate — the existing behaviour, unchanged.
    expect(ids(order)).toEqual(["r1", "n1", "r2", "n2", "r3", "n3"]);
  });

  it("puts every new card after every review when blocked", () => {
    const order = buildReviewOrder(deck(), { newCardCap: 10, blockNewCards: true });
    const firstNew = order.findIndex((c) => c.repetitions === 0);
    const lastReview = order.map((c) => c.repetitions).lastIndexOf(3);
    expect(firstNew).toBeGreaterThan(lastReview);
    expect(order.slice(0, 3).every((c) => c.repetitions > 0)).toBe(true);
  });

  it("does not alternate directions inside the block — recognition first, then production", () => {
    const order = buildReviewOrder(deck(), { newCardCap: 10, blockNewCards: true });
    expect(ids(order.slice(3))).toEqual(["n1", "n3", "n2"]);
  });

  it("still interleaves the review cards' directions", () => {
    const order = buildReviewOrder(deck(), { newCardCap: 10, blockNewCards: true });
    // r1 (rec) is most overdue and leads; the production review is mixed in,
    // not pushed to the end — only *new* cards are blocked.
    expect(ids(order.slice(0, 3))).toEqual(["r1", "r2", "r3"]);
  });

  it("still honours the new-card cap inside the block", () => {
    const order = buildReviewOrder(deck(), { newCardCap: 1, blockNewCards: true });
    expect(ids(order)).toEqual(["r1", "r2", "r3", "n1"]);
  });

  it("admits nothing new when the budget is spent", () => {
    const order = buildReviewOrder(deck(), { newCardCap: 0, blockNewCards: true });
    expect(ids(order)).toEqual(["r1", "r2", "r3"]);
  });

  it("exports a threshold callers gate on", () => {
    expect(BEGINNER_REVIEW_THRESHOLD).toBeGreaterThan(0);
  });
});

describe("recognitionChannel", () => {
  it("reads a brand-new word rather than playing it", () => {
    // Hearing a word you have never seen written is a listening test, not an
    // introduction.
    expect(recognitionChannel({ repetitions: 0, hasAudio: true })).toBe("recognition");
  });

  it("alternates eye and ear on an ordinary card", () => {
    expect(recognitionChannel({ repetitions: 1, hasAudio: true })).toBe("audio");
    expect(recognitionChannel({ repetitions: 2, hasAudio: true })).toBe("recognition");
    expect(recognitionChannel({ repetitions: 3, hasAudio: true })).toBe("audio");
  });

  it("stays on text when there is nothing to play", () => {
    expect(recognitionChannel({ repetitions: 1, hasAudio: false })).toBe("recognition");
    expect(recognitionChannel({ repetitions: 1, hasAudio: false, isLeech: true })).toBe(
      "recognition",
    );
  });

  it("always plays a leech, whichever half of the alternation it is on", () => {
    // Six failures in, half of them through the text channel. Re-serving a
    // failing card in the modality it keeps failing is the one intervention
    // known not to work, so the rotation stops being optional.
    expect(recognitionChannel({ repetitions: 2, hasAudio: true, isLeech: true })).toBe("audio");
    expect(recognitionChannel({ repetitions: 3, hasAudio: true, isLeech: true })).toBe("audio");
  });

  it("does not promote a new leech card straight to audio", () => {
    // repetitions 0 means the direction has never been completed; a leech flag
    // from the *other* direction must not turn the introduction into a test.
    expect(recognitionChannel({ repetitions: 0, hasAudio: true, isLeech: true })).toBe(
      "recognition",
    );
  });
});
