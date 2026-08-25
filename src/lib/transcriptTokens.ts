import type { TranscriptLine, WordToken } from "@/types/transcript";
// Pure module, shared with the edge functions the same way dialectSubvarieties
// is — one definition of "what counts as the same word" on both sides.
import { stripDiacritics } from "../../supabase/functions/_shared/arabicDiacritics";

/**
 * Keeping a line's word tokens honest against its Arabic text.
 *
 * A transcript line stores its Arabic twice: `arabic`, the sentence, and
 * `tokens`, the per-word layer that carries glosses and drives every word-level
 * surface (the learner's tap-a-word popovers, the editor's cards). Every
 * healthy writer keeps them in step — the pipeline builds tokens by splitting
 * the final Arabic on whitespace, and the editor retokenizes on every text
 * edit — so `tokens[i].surface` mirrors `arabic.split(/\s+/)[i]`.
 *
 * But the renderers draw the sentence from `tokens`, while the edit box shows
 * `arabic` — so a line whose tokens have gone stale (an edit saved by an older
 * build that set only the text, or any future writer that touches `arabic`
 * alone) shows the OLD words everywhere except inside the open edit box. A
 * reviewer sees their correction "revert" the moment they click away, and a
 * learner is taught words nobody said.
 *
 * `arabic` is the source of truth: it is what the diff/revision log compares,
 * what the checkmark snapshots, and what every edit actually writes first. So
 * when the two disagree, the tokens are rebuilt from `arabic` — keeping the
 * gloss/id of every word that survived the edit, claimed in order by
 * diacritics-stripped surface, the same rule the editor's own save uses.
 */

/** The words of the line's text, which the tokens are supposed to mirror. */
function arabicWords(line: Pick<TranscriptLine, "arabic">): string[] {
  return (line.arabic ?? "").split(/\s+/).filter(Boolean);
}

/**
 * Whether the token layer still mirrors the Arabic text.
 *
 * Diacritics-insensitive on purpose: tashkeel is pronunciation markup layered
 * onto the same word, so a token that differs from the text only in vowel
 * marks is not stale — and treating it as stale would throw away its gloss.
 */
export function tokensMatchArabic(
  line: Pick<TranscriptLine, "arabic" | "tokens">,
): boolean {
  const words = arabicWords(line);
  const tokens = line.tokens ?? [];
  if (tokens.length !== words.length) return false;
  return tokens.every(
    (token, i) => stripDiacritics(token.surface) === stripDiacritics(words[i]),
  );
}

/**
 * The line with its tokens guaranteed to mirror its Arabic.
 *
 * Returns the line untouched when they already agree (the overwhelmingly
 * common case — no re-render churn). When they disagree, the tokens are
 * rebuilt from the text; each stored token is reclaimed at most once, in
 * order, by diacritics-stripped surface, so the two في in
 * "في البيت في الصباح" keep their own glosses and only the words the edit
 * actually changed come back bare.
 */
export function reconcileLineTokens(line: TranscriptLine): TranscriptLine {
  const words = arabicWords(line);
  const stored = line.tokens ?? [];
  if (stored.length > 0 && tokensMatchArabic(line)) return line;
  // A line with no Arabic has nothing to rebuild from; leave it alone rather
  // than deleting tokens some other field may still be keyed on.
  if (words.length === 0) return line;

  const pool = new Map<string, WordToken[]>();
  for (const token of stored) {
    const key = stripDiacritics(token.surface);
    const queue = pool.get(key);
    if (queue) queue.push(token);
    else pool.set(key, [token]);
  }

  const tokens = words.map<WordToken>((surface) => {
    const cached = pool.get(stripDiacritics(surface))?.shift();
    return {
      id: cached?.id ?? crypto.randomUUID(),
      surface,
      standard: cached?.standard,
      gloss: cached?.gloss,
      compoundRef: cached?.compoundRef,
    };
  });

  return { ...line, tokens };
}

/** Reconcile a whole transcript, reusing the array when nothing changed. */
export function reconcileTranscriptTokens(lines: TranscriptLine[]): TranscriptLine[] {
  let changed = false;
  const next = lines.map((line) => {
    const reconciled = reconcileLineTokens(line);
    if (reconciled !== line) changed = true;
    return reconciled;
  });
  return changed ? next : lines;
}
