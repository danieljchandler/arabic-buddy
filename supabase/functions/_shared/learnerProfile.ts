// Canonical learner model, shared by every content-generating edge function.
//
// The app knows a great deal about what each learner knows — FSRS stability per
// card across the curriculum deck (`word_reviews`) and the personal deck
// (`user_vocabulary`), a CEFR placement per dialect, and a corpus of what they
// keep getting wrong (`learner_errors`). Until now exactly one generator read any
// of it: generate-daily-story, and only the personal deck.
//
// Everything else was level-agnostic. Worse, the couple of functions that took a
// `userVocab` argument were fed the *entire curriculum vocabulary, shuffled*
// (see src/hooks/useAllWords.ts) and told it was "words the student knows" — so
// the personalisation that appeared to exist was actively misinforming the model.
//
// This module replaces both patterns. Build the profile server-side from the
// learner's real SRS state, render it into a prompt block, and pass it to
// askBrain as `systemPromptExtra`.
//
// This file is the IO half; the bucketing/sampling/rendering logic lives in
// learnerProfileCore.ts so it can be unit-tested without Deno.
//
// Cost: three bounded queries plus one profile lookup, all in parallel. Safe to
// call per request.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getDialectLabel, type Dialect } from "./dialectHelpers.ts";
import {
  STRENGTH_LADDER,
  type ConceptMastery,
  type MasteryStrength,
} from "./conceptMasteryCore.ts";
import {
  CHUNK_BUDGET,
  classifyChunks,
  classifyRows,
  DEFAULT_BUDGET,
  DUE_CHUNK_BUDGET,
  renderProfileForPrompt,
  sample,
  type ChunkScheduleRow,
  type LearnerProfile,
  type ProfileBudget,
  type ScheduleRow,
} from "./learnerProfileCore.ts";

export {
  DEFAULT_BUDGET,
  MATURE_INTERVAL_DAYS,
  onScreenVocabBlock,
  renderProfileForPrompt,
} from "./learnerProfileCore.ts";
export type {
  BucketMembership,
  Buckets,
  LearnerChunk,
  LearnerProfile,
  LearnerWord,
  OnScreenVocabItem,
  ProfileBudget,
  ScheduleRow,
} from "./learnerProfileCore.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Service-role client. Reading a learner's own decks needs to cross RLS. */
function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Minimal structural types for the PostgREST client ────────────────────────
// Typed structurally rather than importing SupabaseClient<Database>: an edge
// function has no access to the generated frontend types, and the alternative
// (`any`) loses the shape of what these queries actually return.

type Row = Record<string, unknown>;

interface PostgrestResponse {
  data: unknown;
  error?: { message?: string } | null;
}

interface Query extends PromiseLike<PostgrestResponse> {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  is(column: string, value: unknown): Query;
  order(column: string, opts?: { ascending?: boolean }): Query;
  limit(count: number): Query;
  maybeSingle(): Query;
}

export interface SupabaseLike {
  from(table: string): Query;
}

/** Rows fetched per deck before sampling. Keeps the queries bounded. */
const FETCH_LIMIT = 400;

/** Recent unresolved errors considered when marking words weak. */
const ERROR_LOOKBACK = 60;

/** Grammar concepts fetched. Well above the six drill categories per dialect. */
const MASTERY_LIMIT = 50;

const CEFR_COLUMN: Record<string, string> = {
  gulf: "placement_level_gulf",
  egyptian: "placement_level_egyptian",
  yemeni: "placement_level_yemeni",
};

/** Await a query expected to return many rows; [] on any failure. */
async function safeRows(query: Query): Promise<Row[]> {
  try {
    const { data, error } = await query;
    if (error) {
      console.warn("[learnerProfile] query error:", error.message);
      return [];
    }
    return Array.isArray(data) ? (data as Row[]) : [];
  } catch (e) {
    console.warn("[learnerProfile] query threw:", e);
    return [];
  }
}

/** Await a query expected to return one row; null on any failure. */
async function safeRow(query: Query): Promise<Row | null> {
  try {
    const { data, error } = await query;
    if (error) {
      console.warn("[learnerProfile] query error:", error.message);
      return null;
    }
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Row) : null;
  } catch (e) {
    console.warn("[learnerProfile] query threw:", e);
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

function isStrength(v: unknown): v is MasteryStrength {
  return typeof v === "string" && (STRENGTH_LADDER as readonly string[]).includes(v);
}

/**
 * Assemble the learner profile for one user in one dialect.
 *
 * Uses a service-role client (reading a learner's own decks crosses RLS); pass
 * `supabase` only to override it, e.g. in tests. Never throws: a generator
 * should degrade to unpersonalised output rather than fail the request, so
 * query errors yield empty buckets.
 */
export async function buildLearnerProfile(
  opts: {
    userId: string;
    dialect: Dialect;
    budget?: Partial<ProfileBudget>;
    supabase?: SupabaseLike;
  },
): Promise<LearnerProfile> {
  const { userId, dialect } = opts;
  const supabase = opts.supabase ?? (adminClient() as unknown as SupabaseLike);
  const budget: ProfileBudget = { ...DEFAULT_BUDGET, ...(opts.budget ?? {}) };

  // Each query is independently fault-tolerant: a learner with no personal deck,
  // or an environment where learner_errors hasn't been migrated yet, should still
  // get whatever profile the other queries can produce.
  const [personalRows, curriculumRows, profileRow, errorRows, masteryRows, chunkRows] = await Promise.all([
    safeRows(
      supabase
        .from("user_vocabulary")
        .select("word_arabic, word_english, interval_days, repetitions, lapses, is_leech")
        .eq("user_id", userId)
        .eq("dialect", dialect)
        // Struggling cards first, then most-mature. Ordering by interval alone
        // would put them last — a failed card's interval resets to near zero —
        // so a learner with more than FETCH_LIMIT saved words would have an
        // empty weak set, exactly the learner whose weak set matters most.
        // Lapses are ordered too, not just leeches: classifyRows treats 2+
        // lapses as struggling, well below the leech threshold of 6.
        .order("is_leech", { ascending: false })
        .order("lapses", { ascending: false })
        .order("interval_days", { ascending: false })
        .limit(FETCH_LIMIT),
    ),

    // The curriculum deck has no dialect column of its own — it inherits the
    // dialect from the vocabulary row, hence the inner join + filter.
    safeRows(
      supabase
        .from("word_reviews")
        .select(
          "interval_days, repetitions, lapses, is_leech, " +
            "vocabulary_words!inner(word_arabic, word_english, dialect_module)",
        )
        .eq("user_id", userId)
        .eq("vocabulary_words.dialect_module", dialect)
        // Same ordering as the personal deck, and for the same reason: a failed
        // card's interval resets to near zero, so ordering by interval alone
        // would push exactly the struggling words past FETCH_LIMIT.
        .order("is_leech", { ascending: false })
        .order("lapses", { ascending: false })
        .order("interval_days", { ascending: false })
        .limit(FETCH_LIMIT),
    ),

    safeRow(
      supabase
        .from("profiles")
        .select(
          "proficiency_level, placement_level, learning_reason, interests, placement_level_gulf, placement_level_egyptian, placement_level_yemeni",
        )
        .eq("user_id", userId)
        .maybeSingle(),
    ),

    safeRows(
      supabase
        .from("learner_errors")
        .select("target_arabic")
        .eq("user_id", userId)
        .eq("dialect", dialect)
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(ERROR_LOOKBACK),
    ),

    // Structural weakness, which the word decks can't see: a learner can have
    // every word in a sentence at a comfortable interval and still not be able
    // to negate it. Six drill categories per dialect, so the limit is slack.
    safeRows(
      supabase
        .from("user_concept_mastery")
        .select(
          "exposures, correct, incorrect, ease, strength, next_due_at, last_seen_at, " +
            "curriculum_concepts!inner(key, display_english, kind, dialect)",
        )
        .eq("user_id", userId)
        .eq("curriculum_concepts.kind", "grammar")
        .eq("curriculum_concepts.dialect", dialect)
        .limit(MASTERY_LIMIT),
    ),

    // The chunk deck (set phrases): fixed multi-word sequences with their own
    // recognition and production schedules. Fluent speech is built from these
    // (docs/plateau-research-2026-09.md §3), and no generator knew which ones
    // the learner had — content paraphrased away exactly the phrases the
    // learner had drilled. Most-mature first, same reasoning as the decks.
    safeRows(
      supabase
        .from("user_set_phrases")
        .select(
          "interval_days, repetitions, production_next_review_at, " +
            "set_phrases!inner(phrase_arabic, phrase_english, dialect)",
        )
        .eq("user_id", userId)
        .eq("set_phrases.dialect", dialect)
        .order("interval_days", { ascending: false })
        .limit(FETCH_LIMIT),
    ),
  ]);

  const personal: ScheduleRow[] = personalRows.map((row) => ({
    arabic: str(row.word_arabic),
    english: str(row.word_english),
    intervalDays: num(row.interval_days),
    repetitions: num(row.repetitions),
    lapses: num(row.lapses),
    isLeech: row.is_leech === true,
  }));

  const curriculum: ScheduleRow[] = curriculumRows.map((row) => {
    const joined = (row.vocabulary_words ?? {}) as Row;
    return {
      arabic: str(joined.word_arabic),
      english: str(joined.word_english),
      intervalDays: num(row.interval_days),
      repetitions: num(row.repetitions),
      lapses: num(row.lapses),
      isLeech: row.is_leech === true,
    };
  });

  const errorTargets = new Set(
    errorRows
      .map((e) => str(e.target_arabic)?.trim())
      .filter((t): t is string => !!t),
  );

  const buckets = classifyRows([...personal, ...curriculum], errorTargets);

  const chunkSchedules: ChunkScheduleRow[] = chunkRows.map((row) => {
    const joined = (row.set_phrases ?? {}) as Row;
    return {
      arabic: str(joined.phrase_arabic),
      english: str(joined.phrase_english),
      intervalDays: num(row.interval_days),
      repetitions: num(row.repetitions),
      productionNextReviewAt: str(row.production_next_review_at),
    };
  });
  const chunkBuckets = classifyChunks(chunkSchedules);

  const weakGrammar: ConceptMastery[] = masteryRows.flatMap((row) => {
    const concept = (row.curriculum_concepts ?? {}) as Row;
    const key = str(concept.key);
    if (!key) return [];
    return [{
      conceptKey: key,
      label: str(concept.display_english) ?? key,
      exposures: num(row.exposures) ?? 0,
      correct: num(row.correct) ?? 0,
      incorrect: num(row.incorrect) ?? 0,
      // `ease` is numeric in Postgres, which PostgREST may return as a string.
      ease: Number(row.ease ?? 2.5) || 2.5,
      strength: isStrength(row.strength) ? row.strength : "new",
      nextDueAt: str(row.next_due_at),
      lastSeenAt: str(row.last_seen_at),
    }];
  });

  // Prefer the dialect-specific placement; fall back to the legacy single
  // placement, then to the self-reported level from onboarding.
  const dialectColumn = CEFR_COLUMN[String(dialect).toLowerCase()];
  const level =
    (dialectColumn ? str(profileRow?.[dialectColumn]) : null) ??
    str(profileRow?.placement_level) ??
    str(profileRow?.proficiency_level);

  return {
    userId,
    dialect,
    dialectLabel: getDialectLabel(dialect),
    level,
    reason: str(profileRow?.learning_reason),
    interests: Array.isArray(profileRow?.interests)
      ? profileRow.interests.filter((i): i is string => typeof i === "string")
      : [],
    known: sample(buckets.known, budget.known),
    learning: sample(buckets.learning, budget.learning),
    weak: sample(buckets.weak, budget.weak),
    knownTotal: buckets.known.length,
    chunks: sample(chunkBuckets.known, CHUNK_BUDGET),
    dueChunks: sample(chunkBuckets.due, DUE_CHUNK_BUDGET),
    // Not sampled: there are only six categories, and which grammar point a
    // learner is failing is not something to randomise for variety.
    weakGrammar,
    // Complete membership for the on-screen cross-reference — a sampled list
    // answers "is this word known?" with "no" for words it didn't draw.
    membership: {
      known: buckets.known.map((w) => w.arabic),
      learning: buckets.learning.map((w) => w.arabic),
      weak: buckets.weak.map((w) => w.arabic),
    },
  };
}

/**
 * Convenience wrapper: build and render in one call. Returns "" on any failure,
 * so a generator can append it unconditionally without a try/catch.
 */
export async function learnerPromptBlock(
  opts: {
    userId: string | null | undefined;
    dialect: Dialect;
    budget?: Partial<ProfileBudget>;
    includeWeak?: boolean;
    includeInterests?: boolean;
    supabase?: SupabaseLike;
  },
): Promise<string> {
  if (!opts.userId) return "";
  try {
    const profile = await buildLearnerProfile({
      userId: opts.userId,
      dialect: opts.dialect,
      budget: opts.budget,
      supabase: opts.supabase,
    });
    return renderProfileForPrompt(profile, {
      includeWeak: opts.includeWeak,
      includeInterests: opts.includeInterests,
    });
  } catch (e) {
    console.warn("[learnerProfile] falling back to unpersonalised prompt:", e);
    return "";
  }
}
