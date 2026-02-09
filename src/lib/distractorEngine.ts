/**
 * Smart distractor engine.
 * Picks 3 distractors from a pool, shuffles them with the correct answer.
 */

export interface DistractorWord {
  word_arabic: string;
  word_english: string;
  topic_id?: string;
}

/**
 * Select 3 distractors from the pool, excluding the correct word.
 * Prioritises same-topic words, then recently-learned, then random.
 */
export function pickDistractors(
  correctArabic: string,
  pool: DistractorWord[],
  topicId?: string,
  count = 3
): DistractorWord[] {
  const filtered = pool.filter(w => w.word_arabic !== correctArabic);
  if (filtered.length === 0) return [];

  // Bucket: same topic
  const sameTopic = topicId
    ? filtered.filter(w => w.topic_id === topicId)
    : [];
  // Bucket: different topic
  const diffTopic = filtered.filter(w => !sameTopic.includes(w));

  const result: DistractorWord[] = [];
  const used = new Set<string>();

  const addFrom = (source: DistractorWord[]) => {
    const shuffled = [...source].sort(() => Math.random() - 0.5);
    for (const w of shuffled) {
      if (result.length >= count) break;
      if (!used.has(w.word_arabic)) {
        result.push(w);
        used.add(w.word_arabic);
      }
    }
  };

  // Priority: same topic first, then fill from others
  addFrom(sameTopic);
  addFrom(diffTopic);

  return result;
}

/**
 * Shuffle the correct answer into the options array.
 */
export function shuffleOptions<T>(correct: T, distractors: T[]): T[] {
  const all = [correct, ...distractors];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}
