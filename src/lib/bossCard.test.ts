import { describe, expect, it } from "vitest";
import {
  BOSS_MEMORY,
  bossBeaten,
  bossFor,
  canBeBoss,
  isBossTurn,
  pickBoss,
  withBossFirst,
  type BossCandidate,
  type BossTurnCard,
} from "./bossCard";
import { rungForMemory } from "./quizLadder";

/**
 * The boss card (quiz Phase 7): the recognition leech with the most lapses
 * opens the session as a first look. What has to hold: only a due card can be
 * the boss (the deck is reordered, never added to); only a recognition leech;
 * a tie keeps the deck's order; and the boss opens a session once.
 */

interface Card {
  id: string;
  leech?: boolean;
  lapses?: number;
  direction?: "recognition" | "production";
}
const read = (card: Card): BossCandidate => ({
  isLeech: !!card.leech,
  lapses: card.lapses ?? 0,
  direction: card.direction ?? "recognition",
});
const ids = (cards: Card[]) => cards.map((c) => c.id);

describe("which card is the boss", () => {
  it("is the leech with the most lapses", () => {
    const deck = [{ id: "a" }, { id: "b", leech: true, lapses: 5 }, { id: "c", leech: true, lapses: 9 }, { id: "d" }];
    expect(pickBoss(deck, read)).toBe(2);
  });

  it("keeps the deck's order on a tie: the first of them, the most overdue", () => {
    const deck = [{ id: "a", leech: true, lapses: 6 }, { id: "b", leech: true, lapses: 6 }];
    expect(pickBoss(deck, read)).toBe(0);
  });

  it("is never a card that lapses a lot but is not a leech", () => {
    expect(pickBoss([{ id: "a", lapses: 12 }, { id: "b", leech: true, lapses: 4 }], read)).toBe(1);
  });

  it("is never a production card, whose rating lands on the other schedule", () => {
    expect(pickBoss([{ id: "a", leech: true, lapses: 9, direction: "production" }], read)).toBe(-1);
    expect(canBeBoss({ isLeech: true, lapses: 9, direction: "production" })).toBe(false);
  });

  it("is never a leech with no lapses recorded", () => {
    expect(canBeBoss({ isLeech: true, lapses: 0, direction: "recognition" })).toBe(false);
  });

  it("is nobody in a deck without a leech", () => {
    expect(pickBoss([{ id: "a" }, { id: "b" }], read)).toBe(-1);
    expect(pickBoss([], read)).toBe(-1);
  });
});

describe("the deck with its boss first", () => {
  it("moves the boss to the front and leaves the rest in their order", () => {
    const deck = [{ id: "a" }, { id: "b" }, { id: "c", leech: true, lapses: 7 }, { id: "d" }];
    expect(ids(withBossFirst(deck, read))).toEqual(["c", "a", "b", "d"]);
  });

  it("is the deck itself, as a new array, when the boss is first already or there is none", () => {
    const first = [{ id: "a", leech: true, lapses: 7 }, { id: "b" }];
    const none = [{ id: "a" }, { id: "b" }];
    expect(ids(withBossFirst(first, read))).toEqual(["a", "b"]);
    expect(withBossFirst(none, read)).not.toBe(none);
    expect(ids(withBossFirst(none, read))).toEqual(["a", "b"]);
  });

  it("only reorders: nothing is added or dropped", () => {
    const deck = [{ id: "a" }, { id: "b", leech: true, lapses: 3 }, { id: "c", leech: true, lapses: 8 }];
    expect(ids(withBossFirst(deck, read)).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("when a card is asked as the boss", () => {
  const leech: BossCandidate = { isLeech: true, lapses: 7, direction: "recognition" };

  it("is the session's first card, before anything is answered", () => {
    expect(isBossTurn({ answered: 0, position: 0, candidate: leech })).toBe(true);
  });

  it("opens a session once: not after an answer, and not further down the deck", () => {
    expect(isBossTurn({ answered: 1, position: 0, candidate: leech })).toBe(false);
    expect(isBossTurn({ answered: 0, position: 1, candidate: leech })).toBe(false);
  });

  it("is not a card that cannot be the boss, first or not", () => {
    expect(isBossTurn({ answered: 0, position: 0, candidate: { ...leech, isLeech: false } })).toBe(false);
  });

  it("is asked from a first look's memory, whatever its own", () => {
    expect(rungForMemory(BOSS_MEMORY, "recognition").step).toBe(1);
  });
});

describe("beating the boss", () => {
  it("is a right answer to a card asked as the boss, and nothing else", () => {
    const boss = { lapses: 7 };
    expect(bossBeaten({ correct: true, item: { boss } })).toBe(true);
    expect(bossBeaten({ correct: false, item: { boss } })).toBe(false);
    expect(bossBeaten({ correct: true, item: { boss: null } })).toBe(false);
    expect(bossBeaten({ correct: true, item: {} })).toBe(false);
  });
});

describe("the boss a page puts on the card on screen", () => {
  // Every quiz deck asks this one function, so a deck cannot drift from the
  // others in what makes its first card the boss.
  const leech: BossTurnCard = {
    isLeech: true,
    lapses: 5,
    direction: "recognition",
    mnemonic: "A sock on every stall",
    pictureUrl: "https://img.test/hook.png",
  };
  const turn = (over: Partial<Parameters<typeof bossFor>[0]> = {}) =>
    bossFor({ answered: 0, position: 0, relearn: false, tracking: true, card: leech, ...over });

  it("is the first card's, before any answer, with its lapses, hook and picture", () => {
    expect(turn()).toEqual({ lapses: 5, mnemonic: "A sock on every stall", pictureUrl: "https://img.test/hook.png" });
  });

  it("carries no hook or picture it was not given", () => {
    expect(turn({ card: { isLeech: true, lapses: 2, direction: "recognition" } })).toEqual({
      lapses: 2,
      mnemonic: null,
      pictureUrl: null,
    });
  });

  it("is nobody once a card has been answered, or further down the deck", () => {
    expect(turn({ answered: 1 })).toBeNull();
    expect(turn({ position: 1 })).toBeNull();
  });

  it("is never a relearn card come back, though the list index still reads 0", () => {
    expect(turn({ relearn: true })).toBeNull();
  });

  it("is nobody while the learner does not track leeches", () => {
    expect(turn({ tracking: false })).toBeNull();
  });

  it("is never a card served for production, or one that is not a leech", () => {
    expect(turn({ card: { ...leech, direction: "production" } })).toBeNull();
    expect(turn({ card: { ...leech, isLeech: false } })).toBeNull();
    expect(turn({ card: { ...leech, lapses: 0 } })).toBeNull();
  });
});
