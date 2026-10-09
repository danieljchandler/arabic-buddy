import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { DialogueLine } from "@/lib/quizDialogue";
import {
  assetKey,
  getAssets,
  MAX_KEYS_PER_READ,
  type AssetKey,
  type WordAsset,
  type WordAssetClient,
} from "../../supabase/functions/_shared/wordAssets";
import { asStoredDialogue } from "../../supabase/functions/_shared/wordDialogue";

/** A word the quiz can offer as a wrong option. */
export interface QuizPoolEntry {
  arabic: string;
  english: string;
  /** Its picture, for the picture question's wrong options. */
  imageUrl?: string | null;
  /** Its recording, so a wrong Arabic option can be played. */
  audioUrl?: string | null;
  /**
   * The reply line of its stored exchange (`kind: "dialogue"` in the shared
   * store), for the reply question's wrong replies. Absent when the store has
   * none for it, or it was not among the words read.
   */
  dialogueLine?: DialogueLine | null;
  /** The dialect that reply was filed under (set with `dialogueLine`). */
  dialogueDialect?: string;
}

/** A pool row before the stored replies are read: the entry, its dialect, and how likely it is to have one. */
interface PoolRow {
  entry: QuizPoolEntry;
  dialect: string | null;
  /** Higher is read first when the pool is larger than one read takes. */
  rank: number;
}

const storeKeyOf = (key: { dialect: string | null; conceptKey: string }) => `${key.dialect ?? ""}\u0000${key.conceptKey}`;

/**
 * Each word's stored reply line, read in one query rather than one lookup per
 * word (the pool runs to three hundred).
 *
 * One read takes `MAX_KEYS_PER_READ` keys, so a larger pool has its likeliest
 * words read: an exchange is made when a word reaches the reply step, after a
 * month of reviews, so a learner's most settled words are the ones most
 * likely to have one, and the curriculum's earliest. Three wrong replies are
 * all a question deals, so a hundred words is plenty. Every failure — the
 * store's table not yet on the live project above all — leaves the pool as
 * it was, with no stored replies, and so does a read that takes longer than
 * `STORED_REPLIES_WAIT_MS`.
 */
async function withStoredReplies(rows: PoolRow[]): Promise<QuizPoolEntry[]> {
  const keyed = rows
    .map((row) => ({
      row,
      key: assetKey({ kind: "dialogue", word: row.entry.arabic, gloss: row.entry.english, dialect: row.dialect }),
    }))
    .filter((item): item is { row: PoolRow; key: AssetKey } => item.key !== null)
    .sort((a, b) => b.row.rank - a.row.rank)
    .slice(0, MAX_KEYS_PER_READ);
  if (keyed.length === 0) return rows.map((row) => row.entry);

  // `word_assets` is not in the generated types until its migration is
  // applied, hence the structural client.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const found = await Promise.race<WordAsset[]>([
    getAssets(supabase as unknown as WordAssetClient, keyed.map((item) => item.key)),
    new Promise<WordAsset[]>((resolve) => {
      timer = setTimeout(() => resolve([]), STORED_REPLIES_WAIT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  const byKey = new Map(found.map((asset) => [storeKeyOf(asset), asset]));
  const replies = new Map<QuizPoolEntry, { line: DialogueLine; dialect: string }>();
  for (const { row, key } of keyed) {
    const asset = byKey.get(storeKeyOf(key));
    const exchange = asset ? asStoredDialogue(asset.payload, row.entry.arabic) : null;
    if (exchange) replies.set(row.entry, { line: exchange.lines[1], dialect: key.dialect ?? "" });
  }
  return rows.map((row) => {
    const reply = replies.get(row.entry);
    return reply ? { ...row.entry, dialogueLine: reply.line, dialogueDialect: reply.dialect } : row.entry;
  });
}

/**
 * How long the pool waits for the stored replies before going on without
 * them. The pool holds every card's question back until it loads, so a slow
 * store must not hold the whole session.
 */
export const STORED_REPLIES_WAIT_MS = 2500;

/** Enough to draw three wrong options from without repeating a session. */
const POOL_SIZE = 300;

function usable(
  rows: Array<{ arabic: string | null; english: string | null; imageUrl?: string | null; audioUrl?: string | null }>,
): QuizPoolEntry[] {
  return rows
    .map((row) => ({
      arabic: (row.arabic ?? "").trim(),
      english: (row.english ?? "").trim(),
      imageUrl: row.imageUrl ?? null,
      audioUrl: row.audioUrl ?? null,
    }))
    .filter((row) => row.arabic !== "" && row.english !== "");
}

/** `usable`, keeping each row's dialect and rank alongside for the stored-reply read. */
function usableRows(
  rows: Array<{
    arabic: string | null;
    english: string | null;
    imageUrl?: string | null;
    audioUrl?: string | null;
    dialect: string | null;
    rank: number;
  }>,
): PoolRow[] {
  return rows.flatMap((row) => {
    const [entry] = usable([row]);
    return entry ? [{ entry, dialect: row.dialect, rank: row.rank }] : [];
  });
}

/**
 * Wrong options for the quiz's choice questions, from beyond the due cards.
 *
 * A session of two due cards cannot offer four options from itself, and
 * falling back to the flip card for every small session would make the quiz
 * something only learners with a backlog ever saw. So each deck draws its
 * distractors from the wider deck it belongs to: the dialect's curriculum,
 * or everything the learner has saved. Read only while the quiz style is on
 * (`enabled`), so the flashcards pay nothing for it. A failed read is an
 * empty pool — the frame then falls back card by card — never an error on
 * the review loop.
 *
 * The two word decks also carry each word's stored reply line
 * (`withStoredReplies`), so the reply question has wrong replies for a word
 * whose exchange came from the store rather than its lesson.
 */
export function useCurriculumWordPool(dialect: string, mixAll: boolean, enabled = true) {
  return useQuery({
    queryKey: ["quiz-pool", "curriculum", mixAll ? "all" : dialect],
    enabled,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<QuizPoolEntry[]> => {
      let query = supabase
        .from("vocabulary_words")
        .select("word_arabic, word_english, image_url, audio_url, dialect_module")
        .order("display_order")
        .limit(POOL_SIZE);
      if (!mixAll) query = query.eq("dialect_module", dialect);
      const { data, error } = await query;
      if (error) return [];
      return withStoredReplies(
        usableRows(
          (data ?? []).map((row, i) => ({
            arabic: row.word_arabic,
            english: row.word_english,
            imageUrl: row.image_url,
            audioUrl: row.audio_url,
            dialect: row.dialect_module ?? dialect,
            // The course's earliest words are the first to reach the reply step.
            rank: -i,
          })),
        ),
      );
    },
  });
}

export function useSavedWordPool(dialect: string, mixAll: boolean, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["quiz-pool", "my-words", user?.id, mixAll ? "all" : dialect],
    enabled: enabled && !!user,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<QuizPoolEntry[]> => {
      let query = supabase
        .from("user_vocabulary")
        .select("word_arabic, word_english, image_url, word_audio_url, dialect, ease_factor")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(POOL_SIZE);
      if (!mixAll) query = query.eq("dialect", dialect);
      const { data, error } = await query;
      if (error) return [];
      return withStoredReplies(
        usableRows(
          (data ?? []).map((row) => ({
            arabic: row.word_arabic,
            english: row.word_english,
            imageUrl: row.image_url,
            audioUrl: row.word_audio_url,
            dialect: row.dialect ?? dialect,
            // The stability: the most settled words are the ones that have
            // reached the reply step and had an exchange made.
            rank: Number(row.ease_factor) || 0,
          })),
        ),
      );
    },
  });
}

export function useSavedPhrasePool(dialect: string, mixAll: boolean, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["quiz-pool", "my-phrases", user?.id, mixAll ? "all" : dialect],
    enabled: enabled && !!user,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<QuizPoolEntry[]> => {
      let query = supabase
        .from("user_phrases")
        .select("phrase_arabic, phrase_english")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(POOL_SIZE);
      if (!mixAll) query = query.eq("dialect", dialect);
      const { data, error } = await query;
      if (error) return [];
      return usable((data ?? []).map((row) => ({ arabic: row.phrase_arabic, english: row.phrase_english })));
    },
  });
}
