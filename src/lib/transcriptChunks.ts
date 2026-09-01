/**
 * transcriptChunks — mining chunk candidates out of reviewed transcripts.
 *
 * The chunk deck (set_phrases) needs a dialect-native inventory, and no
 * published formulaic-sequence list exists for any Arabic dialect
 * (docs/plateau-research-2026-09.md §3) — but the app already holds one in
 * embryo: native speakers reviewing transcripts mark multi-word units, and
 * those marks (`WordToken.compoundRef`, or the legacy `(→ first-word)` gloss)
 * have only ever driven word popovers. This module turns them into promotion
 * candidates for /admin/chunks.
 *
 * The compound convention, as the transcript renderers read it
 * (LineByLineTranscript.getCompoundGloss): the FIRST token of a compound
 * carries the whole phrase's gloss; each FOLLOWING token is marked as a
 * continuation. So a candidate is a maximal run of one unmarked token
 * followed by one or more continuation tokens.
 *
 * Pure — no network, no DOM. The shared normaliser is imported the same way
 * transcriptTokens imports arabicDiacritics: one definition of "the same
 * Arabic" on both sides of the stack.
 */

import type { TranscriptLine, WordToken } from "@/types/transcript";
import { normalizeArabic } from "../../supabase/functions/_shared/arabicMatch";

export interface CompoundContext {
  videoId: string;
  videoTitle: string;
  lineArabic: string;
  lineTranslation: string | null;
}

export interface CompoundCandidate {
  /** The compound's surface form, exactly as the transcript spells it. */
  arabic: string;
  /** The whole-phrase gloss from the compound's first token, if any. */
  gloss: string | null;
  /** Occurrences across every line scanned. */
  count: number;
  /** Up to CONTEXT_CAP example lines, first-seen order. */
  contexts: CompoundContext[];
}

/** Example lines kept per candidate — enough to judge, not a concordance. */
const CONTEXT_CAP = 3;

/** A token marked as the continuation of the compound started before it. */
function isContinuation(token: WordToken): boolean {
  return !!token.compoundRef || !!token.gloss?.startsWith("(→");
}

interface VideoLines {
  id: string;
  title: string;
  lines: TranscriptLine[];
}

/**
 * Every compound occurrence in a corpus of reviewed transcripts, grouped on
 * the normalised surface form and ranked by frequency then length. Frequency
 * first because a compound several native speakers marked in several clips is
 * a chunk with evidence behind it; length as the tie-break because longer
 * fixed phrases are the rarer, more valuable finds.
 */
export function collectCompoundCandidates(videos: VideoLines[]): CompoundCandidate[] {
  const byKey = new Map<string, CompoundCandidate>();

  for (const video of videos) {
    for (const line of video.lines ?? []) {
      const tokens = line.tokens ?? [];
      let i = 0;
      while (i < tokens.length) {
        // A run starts at an unmarked token whose successor is a continuation.
        if (isContinuation(tokens[i]) || i + 1 >= tokens.length || !isContinuation(tokens[i + 1])) {
          i += 1;
          continue;
        }
        let end = i + 1;
        while (end < tokens.length && isContinuation(tokens[end])) end += 1;

        const run = tokens.slice(i, end);
        const arabic = run.map((t) => t.surface).join(" ").trim();
        const key = normalizeArabic(arabic);
        i = end;
        if (!key) continue;

        // The first token of the run carries the whole phrase's gloss.
        const gloss = run[0]?.gloss?.trim() || null;
        const context: CompoundContext = {
          videoId: video.id,
          videoTitle: video.title,
          lineArabic: line.arabic ?? "",
          lineTranslation: line.translation ?? null,
        };

        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, {
            arabic,
            gloss: gloss && !gloss.startsWith("(→") ? gloss : null,
            count: 1,
            contexts: [context],
          });
          continue;
        }
        existing.count += 1;
        // A later occurrence can supply the gloss an earlier one lacked.
        if (!existing.gloss && gloss && !gloss.startsWith("(→")) existing.gloss = gloss;
        if (
          existing.contexts.length < CONTEXT_CAP &&
          !existing.contexts.some((c) => c.lineArabic === context.lineArabic)
        ) {
          existing.contexts.push(context);
        }
      }
    }
  }

  return [...byKey.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.arabic.split(" ").length - a.arabic.split(" ").length;
  });
}

/**
 * Candidates not already in the deck, matched on the normalised surface so a
 * hamza-seat or tashkeel difference doesn't re-offer a phrase the deck holds.
 * Drafts count as existing — a candidate someone already promoted is done.
 */
export function filterNewCandidates(
  candidates: CompoundCandidate[],
  existingPhrases: Array<string | null | undefined>,
): CompoundCandidate[] {
  const existing = new Set(
    existingPhrases
      .map((p) => normalizeArabic(p ?? ""))
      .filter((p) => p.length > 0),
  );
  return candidates.filter((c) => !existing.has(normalizeArabic(c.arabic)));
}

/**
 * Lesson-import side of the same idea: a vocabulary entry whose Arabic is
 * multiple words is a chunk being filed as a word. Flagged at import so the
 * importer can also add it to the chunk deck, where the production schedule
 * and the quiz will actually drill it as a phrase.
 */
export function multiWordEntries<T extends { arabic: string }>(entries: T[]): T[] {
  return entries.filter((e) => (e.arabic ?? "").trim().split(/\s+/).length > 1);
}
