// What the tutor carries from one conversation to the next, and the rules for
// when it is worth rewriting. Pure.
//
// The learner model already knows which words are weak and what they have
// watched. What none of it records is what they keep *asking*: that the same
// construction has confused them three times, that an explanation by analogy
// landed where a grammatical one did not. That is what this holds.

export interface LearnerMemory {
  summary: string;
  openQuestions: string[];
  /** Turns already folded into `summary` — the mark left by the last rewrite. */
  turnsSeen: number;
  /**
   * Running total of assistant turns for this learner, across every session.
   *
   * Separate from `turnsSeen` on purpose: one records what the summary covers,
   * the other how far past that the learner has since talked. Collapsing them
   * into one number is what made rewrites unreachable for anyone whose
   * conversations are shorter than the threshold.
   */
  turnsTotal: number;
}

export const EMPTY_MEMORY: LearnerMemory = {
  summary: "",
  openQuestions: [],
  turnsSeen: 0,
  turnsTotal: 0,
};

/** Ceilings. This block rides on every first turn, so it is priced like one. */
export const MAX_SUMMARY_CHARS = 900;
export const MAX_OPEN_QUESTIONS = 5;
export const MAX_OPEN_QUESTION_CHARS = 160;

/**
 * Assistant turns between rewrites.
 *
 * Summarizing after every turn would double the cost of a conversation to
 * re-derive something that barely moved. Waiting until the learner closes the
 * panel would mean never — nothing signals that. Four is roughly one rewrite
 * per real conversation.
 */
export const TURNS_BETWEEN_REWRITES = 4;

/** Read a stored row into a memory, tolerating anything it finds. */
export function parseMemory(row: unknown): LearnerMemory {
  if (!row || typeof row !== "object") return EMPTY_MEMORY;
  const record = row as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const openQuestions = Array.isArray(record.open_questions)
    ? record.open_questions
        .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
        .map((q) => q.trim().slice(0, MAX_OPEN_QUESTION_CHARS))
        .slice(0, MAX_OPEN_QUESTIONS)
    : [];
  const turnsSeen = typeof record.turns_seen === "number" && Number.isFinite(record.turns_seen)
    ? record.turns_seen
    : 0;
  // Rows written before turns_total existed carry only the mark; treating it
  // as the running total too is where they genuinely are.
  const storedTotal =
    typeof record.turns_total === "number" && Number.isFinite(record.turns_total)
      ? record.turns_total
      : 0;
  return {
    summary: summary.slice(0, MAX_SUMMARY_CHARS),
    openQuestions,
    turnsSeen,
    turnsTotal: Math.max(storedTotal, turnsSeen),
  };
}

/** Clamp whatever the summarizer produced before it is stored. */
export function clampMemory(memory: Partial<LearnerMemory>, turnsSeen: number): LearnerMemory {
  const summary = (typeof memory.summary === "string" ? memory.summary.trim() : "").slice(
    0,
    MAX_SUMMARY_CHARS,
  );
  const openQuestions = Array.isArray(memory.openQuestions)
    ? memory.openQuestions
        .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
        .map((q) => q.trim().slice(0, MAX_OPEN_QUESTION_CHARS))
        .slice(0, MAX_OPEN_QUESTIONS)
    : [];
  const seen = Math.max(0, Math.floor(turnsSeen));
  return { summary, openQuestions, turnsSeen: seen, turnsTotal: seen };
}

/**
 * Is this conversation far enough past the last rewrite to be worth another?
 *
 * `assistantTurns` is the running total for the learner (`turnsTotal` plus the
 * turn being folded in), not a count for this session — so a learner who asks
 * two questions a day still gets their memory updated every couple of days
 * rather than never.
 */
export function shouldRewrite(memory: LearnerMemory, assistantTurns: number): boolean {
  if (assistantTurns <= 0) return false;
  return assistantTurns - memory.turnsSeen >= TURNS_BETWEEN_REWRITES;
}

/**
 * Render the memory for the prompt.
 *
 * Hedged on purpose. This is a model's summary of earlier conversations, which
 * makes it the least reliable thing in the prompt — a tutor that treats it as
 * fact will insist a learner has trouble with something they asked about once,
 * months ago, and got right.
 */
export function memoryBlock(memory: LearnerMemory): string {
  if (!memory.summary && memory.openQuestions.length === 0) return "";
  const lines = ["FROM EARLIER CONVERSATIONS WITH THIS LEARNER (your own notes, not their words):"];
  if (memory.summary) lines.push(memory.summary);
  if (memory.openQuestions.length > 0) {
    lines.push(
      `Left unresolved last time: ${memory.openQuestions.map((q) => `"${q}"`).join("; ")}`,
    );
  }
  lines.push(
    "Use this to pitch the explanation and to avoid repeating one that did not land. " +
      "It is a summary written from memory, so treat it as a hint and never as a fact about them — " +
      "do not tell them what they struggle with, and drop it the moment what they say contradicts it.",
  );
  return lines.join("\n");
}
