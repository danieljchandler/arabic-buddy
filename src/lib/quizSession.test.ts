import { describe, expect, it } from "vitest";
import {
  COMBO_MILESTONES,
  EMPTY_QUIZ_SESSION,
  comboBonus,
  nextComboMilestone,
  quizAccuracy,
  recordQuizAnswer,
} from "./quizSession";

/**
 * The session tally. It is display and XP only, so the thing to hold is that
 * it stays honest: a miss resets the combo and nothing else, a bonus pays
 * exactly once per milestone, and the summary's "climbed" count means the
 * next question really is a step up.
 */

const right = (before = 1, after = 2) => ({ correct: true, stepBefore: before, stepAfter: after });
const wrong = (before = 2, after = 1) => ({ correct: false, stepBefore: before, stepAfter: after });

describe("recording answers", () => {
  it("starts empty", () => {
    expect(EMPTY_QUIZ_SESSION).toEqual({
      answered: 0, correct: 0, combo: 0, bestCombo: 0, promotions: 0, demotions: 0,
    });
    expect(quizAccuracy(EMPTY_QUIZ_SESSION)).toBeNull();
  });

  it("counts answers and accuracy", () => {
    let s = recordQuizAnswer(EMPTY_QUIZ_SESSION, right());
    s = recordQuizAnswer(s, wrong());
    s = recordQuizAnswer(s, right());
    expect(s.answered).toBe(3);
    expect(s.correct).toBe(2);
    expect(quizAccuracy(s)).toBeCloseTo(2 / 3);
  });

  it("builds the combo on correct answers and resets it on a miss", () => {
    let s = EMPTY_QUIZ_SESSION;
    for (let i = 0; i < 3; i++) s = recordQuizAnswer(s, right(1, 1));
    expect(s.combo).toBe(3);
    s = recordQuizAnswer(s, wrong());
    expect(s.combo).toBe(0);
    // The best run survives the reset: that is what the summary shows.
    expect(s.bestCombo).toBe(3);
  });

  it("counts climbs and drops from the step before and after", () => {
    let s = recordQuizAnswer(EMPTY_QUIZ_SESSION, right(1, 2));
    s = recordQuizAnswer(s, right(2, 2));
    s = recordQuizAnswer(s, wrong(3, 1));
    expect(s.promotions).toBe(1);
    expect(s.demotions).toBe(1);
  });

  it("does not mutate the previous tally", () => {
    const before = { ...EMPTY_QUIZ_SESSION };
    recordQuizAnswer(EMPTY_QUIZ_SESSION, right());
    expect(EMPTY_QUIZ_SESSION).toEqual(before);
  });
});

describe("combo bonuses", () => {
  it("pays at each milestone exactly, and nowhere else", () => {
    for (const { at, xp } of COMBO_MILESTONES) {
      expect(comboBonus(at)).toBe(xp);
      expect(comboBonus(at - 1)).toBeNull();
      expect(comboBonus(at + 1)).toBeNull();
    }
    expect(comboBonus(0)).toBeNull();
  });

  it("names the next milestone", () => {
    expect(nextComboMilestone(0)).toBe(COMBO_MILESTONES[0].at);
    expect(nextComboMilestone(COMBO_MILESTONES[0].at)).toBe(COMBO_MILESTONES[1].at);
    expect(nextComboMilestone(COMBO_MILESTONES[COMBO_MILESTONES.length - 1].at)).toBeNull();
  });

  it("keeps the bonuses small next to a card's own XP", () => {
    // The flat review XP is 15 per card. A milestone bonus is a flourish.
    for (const { xp, at } of COMBO_MILESTONES) expect(xp).toBeLessThan(15 * at);
  });
});
