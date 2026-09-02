/**
 * Turning a pronunciation assessment into feedback that names the sound.
 *
 * The ASR-feedback meta-analysis is unambiguous on this: explicit corrective
 * feedback (g = 0.86) nearly doubles indirect feedback such as a score or a
 * mismatched transcript (g = 0.50), and segmental feedback (g = 0.82) is
 * where ASR works at all (docs/language-learning-research-2026-09.md §5).
 * Azure already returns the per-phoneme accuracy and the sound it heard
 * instead; this module names them in the learner's terms — the letter, its
 * name, and what it should sound like — and points at the Sound Pairs drill
 * when the confusion is one of ours.
 *
 * Pure. Word/sentence modes only: the shadowing path scores fluency and
 * closeness on purpose (shadowScoring.ts) and never claims a phoneme.
 */
import { LETTERS_BY_CODE } from "@/data/arabicAlphabet";
import { CONTRASTS, type Contrast } from "@/lib/perceptionPairs";

/**
 * Azure's IPA-ish consonant symbols for Arabic locales → arabicAlphabet code.
 * Dialect realisations included where Azure's models emit them (Egyptian g
 * for ج, glottal stop for ق). Vowels are left unmapped on purpose: a vowel
 * quality error has no letter to name and no drill to send it to.
 */
export const IPA_TO_LETTER: Readonly<Record<string, string>> = Object.freeze({
  "ʔ": "hamza",
  "b": "ba",
  "t": "ta",
  "θ": "tha",
  "dʒ": "jim", "ʒ": "jim", "g": "jim", "ɡ": "jim",
  "ħ": "ha",
  "x": "kha", "χ": "kha",
  "d": "dal",
  "ð": "dhal",
  "r": "ra", "ɾ": "ra",
  "z": "zay",
  "s": "sin",
  "ʃ": "shin",
  "sˤ": "sad", "sˁ": "sad", "ṣ": "sad",
  "dˤ": "dad", "dˁ": "dad", "ḍ": "dad",
  "tˤ": "ta_heavy", "tˁ": "ta_heavy", "ṭ": "ta_heavy",
  "ðˤ": "za", "ðˁ": "za", "zˤ": "za", "zˁ": "za",
  "ʕ": "ayn",
  "ɣ": "ghayn", "ʁ": "ghayn",
  "f": "fa",
  "q": "qaf",
  "k": "kaf",
  "l": "lam",
  "m": "mim",
  "n": "nun",
  "h": "ha_soft",
  "w": "waw",
  "j": "ya",
});

/** Letters that carry no entry in the 28-letter table. */
const EXTRA_LETTERS: Readonly<Record<string, { glyph: string; name: string; hint: string }>> = {
  hamza: { glyph: "ء", name: "hamza", hint: "a clean catch in the throat, like the break in 'uh-oh'" },
};

export interface NamedSound {
  code: string;
  glyph: string;
  name: string;
  hint: string;
}

/** The letter behind an IPA symbol, if it is one we can name. */
export function nameSound(ipa: string | null | undefined): NamedSound | null {
  if (!ipa) return null;
  const symbol = ipa.trim().replace(/[ˈˌ.]/g, "");
  const code = IPA_TO_LETTER[symbol] ?? IPA_TO_LETTER[symbol.replace(/ː$/, "")];
  if (!code) return null;
  const letter = LETTERS_BY_CODE[code];
  if (letter) return { code, glyph: letter.isolated, name: letter.name_translit, hint: letter.sound_hint };
  const extra = EXTRA_LETTERS[code];
  return extra ? { code, glyph: extra.glyph, name: extra.name, hint: extra.hint } : null;
}

export interface AssessedPhoneme {
  phoneme: string;
  accuracy: number;
  nbest?: Array<{ phoneme: string; accuracy: number }>;
}

export interface AssessedWord {
  word: string;
  accuracy: number;
  errorType: string;
  phonemes: AssessedPhoneme[];
}

/** Below this, a phoneme is worth talking about. */
export const FEEDBACK_THRESHOLD = 70;

export interface WorstSound {
  word: string;
  phoneme: AssessedPhoneme;
  /** What the learner should have said. */
  target: NamedSound | null;
  /** What Azure heard instead, when it offered an alternative we can name. */
  heard: NamedSound | null;
  /** The Sound Pairs contrast this confusion belongs to, if any. */
  contrast: Contrast | null;
}

/**
 * The single weakest sound across the assessment that we can put a name to.
 *
 * Skips words Azure did not hear at all (an omission is not a mispronounced
 * sound) and phonemes scored 0 inside an otherwise well-scored word (Azure's
 * "not scored" sentinel — see pronunciationScoringCore.worstPhoneme).
 */
export function worstSound(words: AssessedWord[] | undefined): WorstSound | null {
  let worst: WorstSound | null = null;
  for (const word of words ?? []) {
    if (!word || word.errorType === "Omission") continue;
    for (const phoneme of word.phonemes ?? []) {
      const accuracy = Number(phoneme?.accuracy);
      if (!Number.isFinite(accuracy)) continue;
      if (accuracy === 0 && word.accuracy >= 60) continue;
      if (accuracy >= FEEDBACK_THRESHOLD) continue;
      if (worst && accuracy >= worst.phoneme.accuracy) continue;
      const target = nameSound(phoneme.phoneme);
      if (!target) continue;
      const alt = (phoneme.nbest ?? []).find((n) => n.phoneme !== phoneme.phoneme);
      const heard = alt ? nameSound(alt.phoneme) : null;
      worst = { word: word.word, phoneme, target, heard, contrast: contrastFor(target, heard) };
    }
  }
  return worst;
}

function contrastFor(target: NamedSound | null, heard: NamedSound | null): Contrast | null {
  if (!target) return null;
  const codes = new Set([target.code, heard?.code].filter(Boolean));
  return (
    CONTRASTS.find((c) => {
      const pair = new Set([c.aCode ?? (c.a === "ء" ? "hamza" : undefined), c.bCode ?? (c.b === "ء" ? "hamza" : undefined)]);
      if (heard) return pair.has(target.code) && pair.has(heard.code);
      return pair.has(target.code);
    }) ?? null
  );
}

/**
 * One sentence that names the sound, what it should be, and (when Azure
 * heard a nameable alternative) what came out instead.
 */
export function describeWorstSound(sound: WorstSound): string {
  const t = sound.target!;
  const target = `${t.glyph} (${t.name})`;
  const heard = sound.heard && sound.heard.code !== t.code ? ` came out closer to ${sound.heard.glyph} (${sound.heard.name})` : " was the weakest sound";
  return `In ${sound.word}, ${target}${heard}. ${t.glyph} is ${t.hint}.`;
}
