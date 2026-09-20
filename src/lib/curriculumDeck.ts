/**
 * Which curriculum words belong in a learner's flashcard deck.
 *
 * `/review` used to serve *every* `vocabulary_words` row in the active dialect
 * as a new card. Nothing had to be asked for: signing up was enough to have the
 * whole authored curriculum — hundreds of words across stages nobody had opened
 * — poured into the same queue as the words the learner had actually collected
 * themselves (mined from a video, saved from a translation, added by hand). The
 * daily task then counted the two together, so "Review 3 words" opened onto a
 * deck of curriculum cards the learner had never asked to study, with their own
 * three somewhere behind it.
 *
 * So curriculum cards are opt-in now, and there are two ways to opt in:
 *
 *  1. Study the words. Opening a lesson writes `lesson_progress`, and answering
 *     its quiz writes `word_reviews` — either is the learner asking for that
 *     lesson's words. This is the ordinary path and needs no setting.
 *  2. Ask for the whole thing, with the "everything" scope (Settings → Review).
 *     That restores the old behaviour for learners who want the curriculum as
 *     one big deck.
 *
 * A word already carrying a review row is always kept, whatever the scope: it
 * has a live FSRS schedule, and dropping it mid-interval would lose the
 * learner's history with it rather than merely decline to add it.
 *
 * Note this is about the *deck*, not about access: every lesson is still there
 * to be opened. It only decides what turns up unbidden at review time.
 */

export type CurriculumDeckScope =
  /** Only words the learner has studied or started a lesson for. */
  | "requested"
  /** The whole curriculum for the active dialect, as it used to be. */
  | "everything";

export const DEFAULT_CURRICULUM_DECK_SCOPE: CurriculumDeckScope = "requested";

const KEY = "hakiya:curriculum-deck-scope";
const EVENT = "hakiya:curriculum-deck-scope-changed";

export function loadCurriculumDeckScope(): CurriculumDeckScope {
  try {
    return localStorage.getItem(KEY) === "everything"
      ? "everything"
      : DEFAULT_CURRICULUM_DECK_SCOPE;
  } catch {
    return DEFAULT_CURRICULUM_DECK_SCOPE;
  }
}

export function saveCurriculumDeckScope(scope: CurriculumDeckScope) {
  try {
    localStorage.setItem(KEY, scope);
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* no-op */
  }
}

export function subscribeCurriculumDeckScope(cb: () => void) {
  const handler = () => cb();
  window.addEventListener(EVENT, handler as EventListener);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler as EventListener);
    window.removeEventListener("storage", handler);
  };
}

/** The minimum a curriculum word has to carry to be placed. */
export interface CurriculumDeckWord {
  id: string;
  /**
   * The lesson the word belongs to. Null for the legacy topic-backed words,
   * which have no `lesson_progress` row to be started by and so reach the deck
   * only once they have been reviewed at least once.
   */
  lesson_id?: string | null;
}

export interface CurriculumDeckRequest {
  /** Word ids with a `word_reviews` row — words the learner has rated. */
  reviewedWordIds: ReadonlySet<string>;
  /** Lesson ids with a `lesson_progress` row — lessons the learner has opened. */
  startedLessonIds: ReadonlySet<string>;
  scope: CurriculumDeckScope;
}

/** Whether this learner has asked for this curriculum word. */
export function isRequestedCurriculumWord(
  word: CurriculumDeckWord,
  request: CurriculumDeckRequest,
): boolean {
  if (request.scope === "everything") return true;
  // A live schedule is never dropped — see the note above.
  if (request.reviewedWordIds.has(word.id)) return true;
  return !!word.lesson_id && request.startedLessonIds.has(word.lesson_id);
}

/** The curriculum words this learner has asked for, in the order given. */
export function selectRequestedCurriculumWords<T extends CurriculumDeckWord>(
  words: readonly T[],
  request: CurriculumDeckRequest,
): T[] {
  if (request.scope === "everything") return [...words];
  return words.filter((word) => isRequestedCurriculumWord(word, request));
}
