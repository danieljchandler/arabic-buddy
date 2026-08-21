import { describe, expect, it } from "vitest";
import {
  advance,
  currentWordIndex,
  orderQuiz,
  resumeAt,
  startBlock,
  wordsCompleted,
  type LessonFlowState,
  type Shuffle,
} from "./lessonFlow";

/**
 * The lesson walk. What matters is the *gap*: a word must be met, then other
 * words met, before it is tested — otherwise the quiz reads the answer back
 * out of working memory and FSRS records a success nothing earned.
 */

/** Deterministic stand-in for the shuffle: reverse the block. */
const reverse: Shuffle = (indices) => [...indices].reverse();
const opts = { size: 4, shuffle: reverse };

/** Walk the whole lesson, collecting (phase, wordIndex) in order. */
function walk(wordCount: number, size = 4): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  let state: LessonFlowState | null = startBlock(0, wordCount, { size, shuffle: reverse });
  while (state) {
    out.push([state.phase, currentWordIndex(state, wordCount, size)]);
    state = advance(state, wordCount, { size, shuffle: reverse });
  }
  return out;
}

describe("lesson flow", () => {
  it("introduces the whole block before testing any of it", () => {
    expect(walk(4)).toEqual([
      ["intro", 0],
      ["intro", 1],
      ["intro", 2],
      ["intro", 3],
      // Reversed to [3,2,1,0], then rotated off the just-introduced word.
      ["quiz", 2],
      ["quiz", 3],
      ["quiz", 1],
      ["quiz", 0],
    ]);
  });

  it("puts real distance between meeting a word and being asked about it", () => {
    // The property the whole change exists for: no word is quizzed in the step
    // straight after its introduction.
    const steps = walk(8);
    for (let i = 1; i < steps.length; i++) {
      const [phase, word] = steps[i];
      const [prevPhase, prevWord] = steps[i - 1];
      if (phase === "quiz" && prevPhase === "intro") {
        expect(word).not.toBe(prevWord);
      }
    }
    // And every word introduced is eventually tested.
    const quizzed = steps.filter(([p]) => p === "quiz").map(([, w]) => w).sort();
    expect(quizzed).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("runs one block after another", () => {
    const steps = walk(6);
    expect(steps.slice(0, 4).every(([p]) => p === "intro")).toBe(true);
    // Second block is the two words left over, introduced then tested.
    expect(steps.slice(8)).toEqual([
      ["intro", 4],
      ["intro", 5],
      ["quiz", 4],
      ["quiz", 5],
    ]);
  });

  it("handles a lesson shorter than one block", () => {
    expect(walk(2)).toEqual([
      ["intro", 0],
      ["intro", 1],
      ["quiz", 0],
      ["quiz", 1],
    ]);
  });

  it("ends after the last block's quiz", () => {
    // Two words: intro, intro, quiz, quiz — the fourth advance is the end.
    let state: LessonFlowState | null = startBlock(0, 2, opts);
    for (let i = 0; i < 3; i++) {
      state = advance(state!, 2, opts);
      expect(state).not.toBeNull();
    }
    expect(advance(state!, 2, opts)).toBeNull();
  });

  it("resumes at the start of the word's own block", () => {
    // Mid-block resume would quiz words this sitting never introduced.
    expect(resumeAt(6, 12, opts).blockStart).toBe(4);
    expect(resumeAt(6, 12, opts).phase).toBe("intro");
    expect(resumeAt(0, 12, opts).blockStart).toBe(0);
  });

  it("clamps a saved position past the end of a shortened lesson", () => {
    expect(resumeAt(99, 6, opts).blockStart).toBe(4);
  });

  it("counts a block as progress only once it has been tested", () => {
    const intro = startBlock(4, 12, opts);
    // Four words met but none yet recalled — saving them as done would let a
    // resume skip their quiz entirely.
    expect(wordsCompleted(intro, 12, 4)).toBe(4);
    const quizzing = advance(advance(advance(advance(intro, 12, opts)!, 12, opts)!, 12, opts)!, 12, opts)!;
    expect(quizzing.phase).toBe("quiz");
    expect(wordsCompleted(quizzing, 12, 4)).toBe(4);
    const secondAnswer = advance(quizzing, 12, opts)!;
    expect(wordsCompleted(secondAnswer, 12, 4)).toBe(5);
  });
});

describe("orderQuiz", () => {
  it("never opens the quiz on the word just introduced", () => {
    // A plain shuffle would do this 1 time in N, silently reproducing the
    // zero-delay test the block structure exists to prevent.
    const block = [0, 1, 2, 3];
    for (let seed = 0; seed < 4; seed++) {
      // Every rotation of the block, including the one that lands 3 first.
      const rotated: number[] = [...block.slice(seed), ...block.slice(0, seed)];
      expect(orderQuiz(block, () => rotated)[0]).not.toBe(3);
    }
  });

  it("still asks every word in the block exactly once", () => {
    const order = orderQuiz([0, 1, 2, 3], (b) => [...b].reverse());
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
  });

  it("leaves a single-word block alone", () => {
    expect(orderQuiz([7], (b) => b)).toEqual([7]);
  });
});
