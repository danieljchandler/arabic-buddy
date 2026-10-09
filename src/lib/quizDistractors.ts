/**
 * Wrong options for a choice question, picked deterministically.
 *
 * Every quiz card in the tree re-rolled its own Fisher–Yates on mount, which
 * meant a re-render could reshuffle the options under the learner's finger
 * and a test could never say which option was where. This shuffles from a
 * seed — the card's id — so the same card shows the same options for as long
 * as it is on screen, and de-duplicates by a normalised form so two spellings
 * of one word (or "House" and "house") cannot both be offered.
 */

/** A small fast PRNG, seeded from a string. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Fisher–Yates from a string seed. Returns a new array. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const random = mulberry32(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const identity = (s: string) => s.trim().toLowerCase();

/**
 * Up to `count` wrong options from `pool`, none equal to the answer or to each
 * other once normalised, in a seeded order.
 */
export function pickDistractors(
  pool: readonly string[],
  answer: string,
  seed: string,
  count = 3,
  normalize: (s: string) => string = identity,
): string[] {
  const taken = new Set<string>([normalize(answer)]);
  const picks: string[] = [];
  for (const candidate of seededShuffle(pool, `${seed}:distractors`)) {
    if (!candidate) continue;
    const key = normalize(candidate);
    if (!key || taken.has(key)) continue;
    taken.add(key);
    picks.push(candidate);
    if (picks.length === count) break;
  }
  return picks;
}

/**
 * The options for a choice question: the answer plus its distractors, shuffled
 * from the same seed so the answer's position is stable for the card.
 */
export function buildChoices(
  answer: string,
  pool: readonly string[],
  seed: string,
  count = 4,
  normalize: (s: string) => string = identity,
): string[] {
  const distractors = pickDistractors(pool, answer, seed, count - 1, normalize);
  return seededShuffle([answer, ...distractors], `${seed}:choices`);
}
