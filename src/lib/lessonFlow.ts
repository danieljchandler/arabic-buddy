/**
 * The order a lesson introduces and tests its words.
 *
 * A lesson used to run one word at a time: meet it, then answer a
 * multiple-choice question about it seconds later, with nothing in between.
 * The answer is near-certain — the word is still on screen in the learner's
 * head — and it was submitted to FSRS as a confident `good`, granting roughly
 * three days of stability off a zero-delay recognition test. Retrieval with no
 * delay is not retrieval practice: nothing was recalled, so nothing was
 * strengthened, and every word graduated identically regardless of how well it
 * was actually encoded.
 *
 * So words are introduced in small blocks and then tested as a block, in a
 * different order. Three or four intervening items is enough to make the test a
 * real act of recall rather than an echo, while keeping the block short enough
 * that a learner is never asked about something they met a page ago.
 *
 * After the last block's quiz comes one "produce" step (plateau plan Phase
 * 4c): recognising every word in a lesson is not the same skill as using one,
 * and the receptive/productive gap is the plateau's defining feature. One
 * step, not one per word — the lesson stays a lesson, and the production
 * decks carry the long-term load.
 *
 * Pure and injectable-shuffle so the walk can be tested without a component.
 */

export type LessonPhase = "intro" | "quiz" | "produce";

/** How many words are met before the block is tested. */
export const LESSON_BLOCK_SIZE = 4;

export interface LessonFlowState {
  /** Absolute index of the block's first word. */
  blockStart: number;
  phase: LessonPhase;
  /** Position within the current sequence (intro walk, or quiz order). */
  pos: number;
  /** Absolute word indices for this block's quiz, in the order they're asked. */
  quizOrder: number[];
}

export type Shuffle = (indices: number[]) => number[];

/** Fisher-Yates. Replaced in tests with something deterministic. */
export const defaultShuffle: Shuffle = (indices) => {
  const a = [...indices];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Absolute indices belonging to the block that starts at `blockStart`. */
export function blockIndices(blockStart: number, wordCount: number, size = LESSON_BLOCK_SIZE): number[] {
  const end = Math.min(blockStart + size, wordCount);
  const out: number[] = [];
  for (let i = blockStart; i < end; i++) out.push(i);
  return out;
}

/**
 * Order a block's quiz so it never opens on the word just introduced.
 *
 * A plain shuffle has a 1-in-N chance of putting the last word met at the
 * front of the quiz, which reproduces exactly the zero-delay test this whole
 * block structure exists to prevent — and it would do it silently, on some
 * lessons and not others. Rotating that word one place back costs nothing and
 * makes the guarantee unconditional.
 */
export function orderQuiz(block: number[], shuffle: Shuffle = defaultShuffle): number[] {
  const order = shuffle(block);
  const lastIntroduced = block[block.length - 1];
  if (order.length > 1 && order[0] === lastIntroduced) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
}

/** Open a block at its first introduction. */
export function startBlock(
  blockStart: number,
  wordCount: number,
  { size = LESSON_BLOCK_SIZE, shuffle = defaultShuffle }: { size?: number; shuffle?: Shuffle } = {},
): LessonFlowState {
  return {
    blockStart,
    phase: "intro",
    pos: 0,
    quizOrder: orderQuiz(blockIndices(blockStart, wordCount, size), shuffle),
  };
}

/**
 * Where a resumed lesson picks up.
 *
 * Snapped back to the start of the word's own block: resuming mid-block would
 * quiz the learner on words this sitting never introduced.
 */
export function resumeAt(
  wordIndex: number,
  wordCount: number,
  { size = LESSON_BLOCK_SIZE, shuffle = defaultShuffle }: { size?: number; shuffle?: Shuffle } = {},
): LessonFlowState {
  const clamped = Math.max(0, Math.min(wordIndex, Math.max(0, wordCount - 1)));
  return startBlock(Math.floor(clamped / size) * size, wordCount, { size, shuffle });
}

/** The word on screen right now. */
export function currentWordIndex(state: LessonFlowState, wordCount: number, size = LESSON_BLOCK_SIZE): number {
  if (state.phase === "intro") {
    const block = blockIndices(state.blockStart, wordCount, size);
    return block[Math.min(state.pos, block.length - 1)] ?? 0;
  }
  if (state.phase === "produce") {
    // The word that opened the final quiz: of the block, it is the one whose
    // test carried the longest delay — the best-encoded candidate to now
    // produce with.
    return state.quizOrder[0] ?? 0;
  }
  return state.quizOrder[Math.min(state.pos, state.quizOrder.length - 1)] ?? 0;
}

/**
 * The next step, or null when the lesson is finished.
 *
 * intro → next intro in the block → the block's quiz → next block's intros.
 */
export function advance(
  state: LessonFlowState,
  wordCount: number,
  { size = LESSON_BLOCK_SIZE, shuffle = defaultShuffle }: { size?: number; shuffle?: Shuffle } = {},
): LessonFlowState | null {
  const block = blockIndices(state.blockStart, wordCount, size);

  if (state.phase === "intro") {
    if (state.pos + 1 < block.length) return { ...state, pos: state.pos + 1 };
    // Every word met; now test them, in an order that isn't the order they came in.
    return { ...state, phase: "quiz", pos: 0 };
  }

  if (state.phase === "produce") return null;

  if (state.pos + 1 < state.quizOrder.length) return { ...state, pos: state.pos + 1 };

  const nextStart = state.blockStart + block.length;
  if (nextStart >= wordCount) {
    // Every word met and tested — now use one. Recognition of the whole
    // lesson is still not production of any of it.
    return { ...state, phase: "produce", pos: 0 };
  }
  return startBlock(nextStart, wordCount, { size, shuffle });
}

/**
 * How many words the learner has worked through, for the progress bar and the
 * saved position. Counts a block as done only once it has been tested — a word
 * that was introduced but not yet quizzed is not learned, and saving it as
 * progress would let a resume skip its quiz.
 */
export function wordsCompleted(state: LessonFlowState, wordCount: number, size = LESSON_BLOCK_SIZE): number {
  const block = blockIndices(state.blockStart, wordCount, size);
  if (state.phase === "intro") return state.blockStart;
  // The produce step only exists once every word has been tested.
  if (state.phase === "produce") return wordCount;
  return state.blockStart + Math.min(state.pos, block.length);
}
