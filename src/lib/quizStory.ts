import type { WordSpan } from "@/lib/arabicWord";
import { findPhraseSpan } from "@/lib/quizDialogue";
import { wordUseCount } from "../../supabase/functions/_shared/wordDialogue";
import type { StoredStoryLine } from "../../supabase/functions/_shared/wordStoryLine";

/**
 * The quiz's top step, "in a story" (quiz Phase 6): a word's two-sentence
 * passage (`kind: "story_line"` in the shared store) with the word cut out.
 *
 * The passage was checked where it was filed and again where it was read
 * (`asStoredStoryLine`: two sentences, the word in one and said nowhere else),
 * so all that is left here is where to cut. That is `findPhraseSpan`, the
 * quiz's one rule for the word's span in a line, so a phrase (كل يوم) is cut
 * whole and a word's attached punctuation stays in the sentence. A passage it
 * cannot cut is no question: the card is asked the step below.
 */

export interface StoryGap {
  /** The two sentences, in order, each with its English. */
  sentences: StoredStoryLine["sentences"];
  /** The sentence the gap is in. */
  gap: 0 | 1;
  /** The gap's sentence either side of the word. */
  before: string;
  after: string;
  /** The whole passage as it is read aloud: the two sentences, one after the other. */
  text: string;
  /** Where the word is in `text`, for muting it. */
  span: WordSpan;
  /** The passage's English. */
  english: string;
  /** The published story it was taken from, if it was, unless its title says the word. */
  title: string | null;
}

/** The passage with the word's gap cut, or null when there is no gap to cut. */
export function storyGap(line: StoredStoryLine | null | undefined, word: string): StoryGap | null {
  if (!line) return null;
  const sentence = line.sentences[line.gap].arabic;
  const cut = findPhraseSpan(sentence, word);
  if (!cut) return null;
  const [first, second] = line.sentences;
  const text = `${first.arabic} ${second.arabic}`;
  // The gap's offset in the joined text: after the first sentence and its space when it is the second.
  const offset = line.gap === 0 ? 0 : first.arabic.length + 1;
  // A title that says the word would give the gap away.
  const named = line.story ? line.story.title || line.story.titleArabic || null : null;
  const title = named && wordUseCount(named, word) === 0 ? named : null;
  return {
    sentences: line.sentences,
    gap: line.gap,
    before: sentence.slice(0, cut.start),
    after: sentence.slice(cut.end),
    text,
    span: { start: offset + cut.start, end: offset + cut.end },
    english: `${first.english} ${second.english}`,
    title,
  };
}

/**
 * What a wrong pick asks the tutor ("Why not this one?"): the pair, and the
 * passage it was picked for, so the answer is about this gap and not about
 * the two words in general.
 */
export function whyNotQuestion(input: { picked: string; answer: string; meaning: string }): string {
  return (
    `In this passage I put «${input.picked}» in the gap, but the word is «${input.answer}» ("${input.meaning}"). ` +
    `Why doesn't «${input.picked}» fit here?`
  );
}
