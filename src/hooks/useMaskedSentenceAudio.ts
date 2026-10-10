import { useMemo } from "react";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import type { WordSpan } from "@/lib/arabicWord";

/**
 * The text with the word's span read as a pause: what the voice is given
 * before the answer, so the word is not in it at all. Everything either side
 * is read as written.
 */
export function maskedSentence(text: string, span: WordSpan | null): string {
  if (!span) return text;
  return `${text.slice(0, span.start)} ... ${text.slice(span.end)}`.replace(/\s+/g, " ").trim();
}

interface MaskedSentenceAudioOptions {
  /** The sentence (or a story's two), word and all. */
  text: string;
  /** Where the word is in `text`. With none there is no gap, and nothing is read before the answer. */
  span: WordSpan | null;
  /**
   * The dialect `text` is in. Both readings are in its voice — the muted one
   * and the whole one after the answer — so the gap is heard in the voice the
   * rest of the sentence is read in. Unset, the learner's active dialect.
   */
  dialect?: string | null;
  /** The answer is in: the whole sentence is played from now on. */
  revealed: boolean;
  /**
   * A recording of the whole sentence, played once revealed instead of
   * synthesising it. Never before: a recording says the word.
   */
  recordingUrl?: string | null;
  /** Read nothing: no synthesis at all (the lightning round, which costs nothing). */
  skip?: boolean;
}

/**
 * The sentence a gap was cut from, read aloud with the word muted until the
 * learner has answered, and whole after.
 *
 * The cloze card's audio, and the quiz's story passage's (Phase 6): one
 * implementation, so a gap is muted the same way wherever it is cut. The
 * muted reading is synthesised from `maskedSentence` (the word replaced by a
 * pause in the text itself, so no voice can say it); after the answer the
 * recording plays if there is one, else the whole text is synthesised, in the
 * same dialect's voice as the muted reading.
 */
export function useMaskedSentenceAudio({
  text,
  span,
  dialect,
  revealed,
  recordingUrl,
  skip = false,
}: MaskedSentenceAudioOptions): { url: string | null; isLoading: boolean; masked: string } {
  const start = span?.start;
  const end = span?.end;
  const masked = useMemo(
    () => maskedSentence(text, start === undefined || end === undefined ? null : { start, end }),
    [text, start, end],
  );
  const voice = dialect ?? undefined;
  const muted = useAzureTTS({ text: masked, skip: skip || !span, dialect: voice });
  const whole = useAzureTTS({ text, skip: skip || Boolean(recordingUrl) || !revealed, dialect: voice });
  if (!revealed) return { url: muted.ttsUrl, isLoading: muted.isLoading, masked };
  return { url: recordingUrl || whole.ttsUrl, isLoading: recordingUrl ? false : whole.isLoading, masked };
}
