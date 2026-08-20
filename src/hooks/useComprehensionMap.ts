import { useMemo } from "react";
import { useUserVocabulary } from "@/hooks/useUserVocabulary";
import { useUserPhrases } from "@/hooks/useUserPhrases";
import {
  buildKnownTokenSet,
  contentComprehension,
  MIN_KNOWN_WORDS,
  type Comprehension,
} from "@/lib/comprehension";

/**
 * Anything the learner can read or listen to, whatever field its Arabic
 * happens to live in: a Discover video's transcript, a Listen episode's
 * script, a Reading Library story's prose body.
 */
interface ContentLike {
  id: string;
  dialect?: string | null;
  /** Discover: [{ arabic, english }] */
  transcript_lines?: unknown;
  /** Listen: the same line shape under a different name. */
  script?: unknown;
  /** Reading Library: one Arabic string. */
  body_dialect?: string | null;
}

/**
 * Per-item comprehension for the signed-in learner, computed from the decks
 * already in the react-query cache — no extra network. Returns an empty map
 * until the learner has saved enough words for coverage to mean anything
 * (MIN_KNOWN_WORDS), so a brand-new account sees the ordinary list rather
 * than a wall of red bars.
 */
export function useComprehensionMap(
  items: ContentLike[] | undefined,
): Map<string, Comprehension> {
  const { data: words } = useUserVocabulary();
  const { data: phrases } = useUserPhrases();

  return useMemo(() => {
    const map = new Map<string, Comprehension>();
    const entries = [
      ...(words ?? []).map((w) => w.word_arabic),
      ...(phrases ?? []).map((p) => p.phrase_arabic),
    ];
    const known = buildKnownTokenSet(entries);
    if (known.size < MIN_KNOWN_WORDS) return map;

    for (const item of items ?? []) {
      // First field that actually carries text wins; an item with none simply
      // gets no bar.
      const source = item.transcript_lines ?? item.script ?? item.body_dialect;
      const result = contentComprehension(source, known, item.dialect);
      if (result) map.set(item.id, result);
    }
    return map;
  }, [items, words, phrases]);
}
