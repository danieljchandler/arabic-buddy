// Does this video's audio actually contain Arabic worth transcribing?
//
// Every ASR engine in the pipeline is pinned to Arabic, and an Arabic-pinned
// engine handed an English pop song, a laugh track, or thirty seconds of
// background music does not return nothing — it returns confident Arabic-script
// nonsense. Downstream that becomes a transcript, a vocabulary list, and a
// difficulty rating for words nobody said. Memes are where it bites hardest:
// the joke is written on screen, the audio is a trending song, and the whole
// "transcript" is invented.
//
// Arabic singing is NOT a failure case. A learner studying an Arabic song wants
// the lyrics; only non-Arabic audio and silence are dropped.

/** What the audio turned out to be. */
export type AudioVerdict = "arabic_speech" | "arabic_singing" | "non_arabic" | "no_speech";

/** The deterministic half of the decision, from the ASR text alone. */
export type ScriptReading = "arabic" | "non_arabic" | "no_speech" | "unclear";

export interface SpeechGateReading {
  reading: ScriptReading;
  /** Arabic letters as a share of all letters across the engine transcripts. */
  arabicLetterRatio: number;
  /** Characters in the longest engine transcript. */
  longestLength: number;
  /** Best word overlap between any two engines, or null with fewer than two. */
  agreement: number | null;
  /** Human-readable evidence, for the row's provenance blob. */
  notes: string[];
}

// Arabic letters only: the block above the diacritics (U+064B-U+065F) and
// clear of the Arabic-Indic digits (U+0660-U+0669), plus the extended letters
// dialect spelling uses (چ for ك, گ for ق).
const ARABIC_LETTER = /[\u0620-\u064A\u066E-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FF]/;
const LATIN_LETTER = /[A-Za-z]/;
const DIACRITICS = /[\u064B-\u065F\u0670]/g;

/** Any Arabic letter at all. */
export function hasArabicScript(text: unknown): boolean {
  return ARABIC_LETTER.test(String(text ?? ""));
}

function letterCounts(text: string): { arabic: number; latin: number } {
  let arabic = 0;
  let latin = 0;
  for (const ch of text) {
    if (ARABIC_LETTER.test(ch)) arabic++;
    else if (LATIN_LETTER.test(ch)) latin++;
  }
  return { arabic, latin };
}

function words(text: string): string[] {
  return text
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  return shared / (setA.size + setB.size - shared);
}

/** Below this many letters an engine transcript is treated as having said nothing. */
const MIN_MEANINGFUL_LETTERS = 8;
/** Below this share of Arabic letters the engines were transcribing another language outright. */
const MIN_ARABIC_LETTER_RATIO = 0.35;
/**
 * Two Arabic engines on the same real speech share a good part of their
 * wording even when they disagree about the dialect. Two engines hallucinating
 * over music share almost nothing. This is deliberately far below the
 * disagreement of a genuinely hard clip — it flags for the model to confirm,
 * it does not decide on its own.
 */
const HALLUCINATION_AGREEMENT = 0.12;
/** Agreement is only meaningful once there are enough words to compare. */
const MIN_WORDS_FOR_AGREEMENT = 6;

/**
 * Read the ASR output as script and cross-engine agreement.
 *
 * Deliberately conservative: it returns `non_arabic` only when the engines
 * themselves wrote another language, and otherwise defers — `unclear` means
 * "ask the model", not "drop this".
 */
export function readAsrScript(transcripts: Array<string | null | undefined>): SpeechGateReading {
  const texts = transcripts.map((t) => String(t ?? "").trim()).filter(Boolean);
  const notes: string[] = [];

  const counts = texts.map(letterCounts);
  const arabic = counts.reduce((sum, c) => sum + c.arabic, 0);
  const latin = counts.reduce((sum, c) => sum + c.latin, 0);
  const total = arabic + latin;
  const arabicLetterRatio = total === 0 ? 0 : arabic / total;
  const longestLength = texts.reduce((max, t) => Math.max(max, t.length), 0);

  const substantive = texts.filter((t, i) => counts[i].arabic + counts[i].latin >= MIN_MEANINGFUL_LETTERS);

  let agreement: number | null = null;
  const wordSets = substantive.map(words).filter((w) => w.length >= MIN_WORDS_FOR_AGREEMENT);
  if (wordSets.length >= 2) {
    agreement = 0;
    for (let i = 0; i < wordSets.length; i++) {
      for (let j = i + 1; j < wordSets.length; j++) {
        agreement = Math.max(agreement, jaccard(wordSets[i], wordSets[j]));
      }
    }
  }

  if (substantive.length === 0) {
    notes.push("no engine returned a transcript long enough to be speech");
    return { reading: "no_speech", arabicLetterRatio, longestLength, agreement, notes };
  }

  if (total > 0 && arabicLetterRatio < MIN_ARABIC_LETTER_RATIO) {
    notes.push(`engines returned mostly non-Arabic script (${Math.round(arabicLetterRatio * 100)}% Arabic letters)`);
    return { reading: "non_arabic", arabicLetterRatio, longestLength, agreement, notes };
  }

  if (agreement !== null && agreement < HALLUCINATION_AGREEMENT) {
    notes.push(`engines barely agree (${agreement.toFixed(2)} word overlap) — possible hallucination over music`);
    return { reading: "unclear", arabicLetterRatio, longestLength, agreement, notes };
  }

  return { reading: "arabic", arabicLetterRatio, longestLength, agreement, notes };
}

/** Coerce a model's self-reported verdict into the enum, or null if it said something else. */
export function parseAudioVerdict(raw: unknown): AudioVerdict | null {
  const value = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "arabic_speech" || value === "arabic" || value === "speech") return "arabic_speech";
  if (value === "arabic_singing" || value === "arabic_song" || value === "singing") return "arabic_singing";
  if (value === "non_arabic" || value === "not_arabic" || value === "english") return "non_arabic";
  if (value === "no_speech" || value === "silence" || value === "music" || value === "music_only") return "no_speech";
  return null;
}

export interface AudioDecision {
  verdict: AudioVerdict;
  /** Whether the spoken transcript should be kept at all. */
  keepAudioLines: boolean;
  reason: string;
}

/**
 * Combine what the text looks like with what the model said about it.
 *
 * The script reading wins when it is decisive — an engine that literally wrote
 * English is not a matter of opinion. Everywhere else the model decides, and
 * where neither is sure the audio is kept: a wrongly dropped transcript is a
 * worse failure than a doubtful one, because the learner can see the doubtful
 * one is wrong and cannot see the missing one at all.
 */
export function decideAudio(
  reading: SpeechGateReading,
  modelVerdict: AudioVerdict | null,
): AudioDecision {
  if (reading.reading === "no_speech") {
    return { verdict: "no_speech", keepAudioLines: false, reason: reading.notes[0] ?? "no speech detected" };
  }
  if (reading.reading === "non_arabic") {
    return { verdict: "non_arabic", keepAudioLines: false, reason: reading.notes[0] ?? "audio is not Arabic" };
  }
  if (modelVerdict === "non_arabic") {
    return { verdict: "non_arabic", keepAudioLines: false, reason: "the audio is not Arabic" };
  }
  if (modelVerdict === "no_speech") {
    return { verdict: "no_speech", keepAudioLines: false, reason: "the audio has no intelligible speech" };
  }
  if (modelVerdict === "arabic_singing") {
    return { verdict: "arabic_singing", keepAudioLines: true, reason: "Arabic singing" };
  }
  return {
    verdict: "arabic_speech",
    keepAudioLines: true,
    reason: reading.notes[0] ?? "Arabic speech",
  };
}

/**
 * Drop lines that contain no Arabic at all.
 *
 * A whole line of Latin script in an Arabic transcript is engine noise or an
 * English song lyric far more often than it is content a learner of Arabic
 * needs. Mixed lines survive untouched — Gulf speech code-switches constantly,
 * and "بس الـ deadline قريب" is a real sentence.
 */
export function dropNonArabicLines<T extends { arabic?: unknown }>(lines: T[] | null | undefined): T[] {
  if (!Array.isArray(lines)) return [];
  return lines.filter((line) => hasArabicScript(line?.arabic));
}

/** The note left on a video whose audio was rejected, so review knows why. */
export function noArabicSpeechNote(decision: AudioDecision, hasScreenText: boolean): string {
  const what = decision.verdict === "no_speech"
    ? "No intelligible speech was found in this video's audio"
    : "This video's audio is not Arabic";
  const tail = hasScreenText
    ? "the on-screen text was kept and the spoken transcript left empty."
    : "there is nothing to transcribe.";
  return `${what} (${decision.reason}), so ${tail}`;
}
