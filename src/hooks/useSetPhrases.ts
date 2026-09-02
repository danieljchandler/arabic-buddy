import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toInvokeFailureError } from "@/lib/invokeError";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { calculateNextReview, elapsedDaysSince, type Rating } from "@/lib/spacedRepetition";
import { useDesiredRetention } from "./useDesiredRetention";
import { useFsrsCalibration } from "./useFsrsCalibration";
import { useFsrsWeights } from "@/hooks/useFsrsWeights";

const sb = supabase as any;

export interface SetPhraseOccasion {
  id: string;
  slug: string;
  name: string;
  name_arabic: string | null;
  description: string | null;
  icon_name: string;
  display_order: number;
  dialect: string;
  difficulty_floor: string;
}

export interface SetPhrase {
  id: string;
  occasion_id: string | null;
  dialect: string;
  phrase_arabic: string;
  phrase_transliteration: string | null;
  phrase_english: string | null;
  phrase_literal: string | null;
  phrase_audio_url: string | null;
  reply_arabic: string | null;
  reply_transliteration: string | null;
  reply_english: string | null;
  reply_literal: string | null;
  reply_audio_url: string | null;
  scenario_english: string | null;
  cultural_note: string | null;
  formality: string;
  difficulty: string;
  accepted_variants: string[];
  cached_distractors: { arabic: string; english?: string }[];
  status: string;
  tags: string[];
}

export const useSetPhraseOccasions = () => {
  const { activeDialect } = useDialect();
  return useQuery({
    queryKey: ["set-phrase-occasions", activeDialect],
    queryFn: async () => {
      const { data, error } = await sb
        .from("set_phrase_occasions")
        .select("*")
        .eq("dialect", activeDialect)
        .eq("status", "published")
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as SetPhraseOccasion[];
    },
  });
};

export const useSetPhrasesByOccasion = (occasionId: string | undefined) => {
  const { activeDialect } = useDialect();
  return useQuery({
    queryKey: ["set-phrases", activeDialect, occasionId],
    queryFn: async () => {
      if (!occasionId) return [];
      const { data, error } = await sb
        .from("set_phrases")
        .select("*")
        .eq("dialect", activeDialect)
        .eq("status", "published")
        .eq("occasion_id", occasionId)
        .order("difficulty");
      if (error) throw error;
      return (data ?? []) as SetPhrase[];
    },
    enabled: !!occasionId,
  });
};

export interface UserSetPhrase {
  id: string;
  user_id: string;
  phrase_id: string;
  source: string;
  ease_factor: number;
  difficulty?: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
  last_reviewed_at: string | null;
  last_quality: number | null;
  // Production track (say the phrase, not just spot it). Mirrors the word
  // decks; production_next_review_at is null until unlocked.
  production_ease_factor?: number | null;
  production_difficulty?: number | null;
  production_interval_days?: number | null;
  production_repetitions?: number | null;
  production_lapses?: number | null;
  production_next_review_at?: string | null;
  production_last_reviewed_at?: string | null;
  set_phrases?: SetPhrase;
}

export const useUserSetPhrases = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["user-set-phrases", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await sb
        .from("user_set_phrases")
        .select("*, set_phrases(*)")
        .eq("user_id", user.id)
        .order("next_review_at");
      if (error) throw error;
      return (data ?? []) as UserSetPhrase[];
    },
    enabled: !!user,
  });
};

export const useUserSetPhrasesDueCount = () => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  return useQuery({
    queryKey: ["user-set-phrases-due", user?.id, activeDialect],
    queryFn: async () => {
      if (!user) return 0;
      const nowIso = new Date().toISOString();
      // Inner-join on set_phrases so we only count rows whose phrase matches
      // the active dialect. A row counts as due when either track is due —
      // the production track exists precisely so "can say it" is scheduled
      // separately from "can spot it".
      const { count, error } = await sb
        .from("user_set_phrases")
        .select("*, set_phrases!inner(dialect)", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("set_phrases.dialect", activeDialect)
        .or(`next_review_at.lte.${nowIso},production_next_review_at.lte.${nowIso}`);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user,
  });
};

export const useSavePhrase = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ phraseId, source = "manual_save" }: { phraseId: string; source?: string }) => {
      if (!user) throw new Error("login required");
      const { error } = await sb.from("user_set_phrases").upsert(
        {
          user_id: user.id,
          phrase_id: phraseId,
          source,
        },
        { onConflict: "user_id,phrase_id", ignoreDuplicates: true },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-set-phrases"] });
      qc.invalidateQueries({ queryKey: ["user-set-phrases-due"] });
    },
  });
};

/** How the learner answered — decides which schedule(s) the grade lands on. */
export type PhraseAnswerMode = "voice" | "choice";

/** Map the scorers' quality 0..5 onto an FSRS rating. */
export function phraseRating(quality: number): Rating {
  return quality >= 5 ? "easy" : quality >= 4 ? "good" : quality >= 3 ? "hard" : "again";
}

/**
 * The column update for one graded set-phrase answer.
 *
 * Two schedules, mirroring the word decks (see buildReviewUpdate in
 * useReview.ts): recognition (spot the phrase) and production (say it) — the
 * skill this deck actually exists for, per the chunk research
 * (docs/plateau-research-2026-09.md §3).
 *
 * - A **choice** answer grades recognition only; a confident one (good/easy)
 *   unlocks the production track, the same rule the word decks use.
 * - A **voice** answer grades BOTH tracks from the same rating. Saying the
 *   phrase is direct evidence of recognising it too, and a voice-first
 *   learner would otherwise leave the recognition schedule permanently due.
 *   Grading production also starts it if it was still locked — speaking is
 *   the stronger unlock.
 *
 * Pure and exported so the mapping is testable: a voice grade landing only on
 * the recognition columns silently recreates the single-schedule deck this
 * migration exists to fix.
 */
export function buildPhraseReviewRow(
  quality: number,
  mode: PhraseAnswerMode,
  existing: Partial<UserSetPhrase> | null,
  now: Date = new Date(),
  options?: Parameters<typeof calculateNextReview>[6],
): Record<string, unknown> {
  const rating = phraseRating(quality);
  const nowIso = now.toISOString();
  const row: Record<string, unknown> = {
    source: existing?.source ?? "reviewed",
    last_quality: quality,
  };

  const gradeRecognition = () => {
    const next = calculateNextReview(
      rating,
      existing?.ease_factor ?? 0,
      existing?.difficulty ?? 5,
      existing?.interval_days ?? 0,
      existing?.repetitions ?? 0,
      elapsedDaysSince(existing?.last_reviewed_at ?? null),
      options,
    );
    row.ease_factor = next.stability;
    row.difficulty = next.difficulty;
    row.interval_days = Math.max(1, Math.round(next.intervalDays));
    row.repetitions = next.repetitions;
    row.next_review_at = next.nextReviewAt.toISOString();
    row.last_reviewed_at = nowIso;
  };

  const gradeProduction = () => {
    const next = calculateNextReview(
      rating,
      existing?.production_ease_factor ?? 0,
      existing?.production_difficulty ?? 5,
      existing?.production_interval_days ?? 0,
      existing?.production_repetitions ?? 0,
      elapsedDaysSince(existing?.production_last_reviewed_at ?? null),
      options,
    );
    row.production_ease_factor = next.stability;
    row.production_difficulty = next.difficulty;
    row.production_interval_days = Math.max(1, Math.round(next.intervalDays));
    row.production_repetitions = next.repetitions;
    row.production_next_review_at = next.nextReviewAt.toISOString();
    row.production_last_reviewed_at = nowIso;
    row.production_lapses =
      (existing?.production_lapses ?? 0) + (rating === "again" ? 1 : 0);
  };

  gradeRecognition();
  if (mode === "voice") {
    gradeProduction();
  } else if (
    (rating === "good" || rating === "easy") &&
    !existing?.production_next_review_at
  ) {
    row.production_next_review_at = nowIso;
  }

  return row;
}

export const useReviewPhrase = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const desiredRetention = useDesiredRetention();
  const stabilityMultiplier = useFsrsCalibration();
  const { weights } = useFsrsWeights();
  return useMutation({
    mutationFn: async ({
      phraseId,
      quality,
      mode = "choice",
    }: {
      phraseId: string;
      quality: number;
      mode?: PhraseAnswerMode;
    }) => {
      if (!user) throw new Error("login required");

      const { data: existing } = await sb
        .from("user_set_phrases")
        .select("*")
        .eq("user_id", user.id)
        .eq("phrase_id", phraseId)
        .maybeSingle();

      const row = {
        user_id: user.id,
        phrase_id: phraseId,
        ...buildPhraseReviewRow(quality, mode, existing, new Date(), {
          desiredRetention,
          stabilityMultiplier,
          weights,
          fuzzSeed: phraseId,
        }),
      };

      const { error } = await sb
        .from("user_set_phrases")
        .upsert(row, { onConflict: "user_id,phrase_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-set-phrases"] });
      qc.invalidateQueries({ queryKey: ["user-set-phrases-due"] });
    },
  });
};

export const useLogQuizAttempt = () => {
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (a: {
      phrase_id: string;
      question_type: "reply" | "scenario";
      answer_mode: "voice" | "choice";
      correct: boolean;
      asr_transcript?: string | null;
      asr_similarity?: number | null;
    }) => {
      if (!user) return;
      await sb.from("set_phrase_quiz_attempts").insert({ ...a, user_id: user.id });
    },
  });
};

export interface QuizItem {
  phrase_id: string;
  question_type: "reply" | "scenario";
  prompt: { arabic?: string; english?: string; audio_url?: string | null };
  expected_arabic: string;
  expected_english?: string | null;
  expected_transliteration?: string | null;
  expected_audio_url?: string | null;
  cultural_note?: string | null;
  formality?: string | null;
  occasion?: { name: string; icon_name: string } | null;
  choices: { arabic: string; english?: string; correct: boolean }[];
  is_due_review: boolean;
}

export const useGenerateQuiz = () => {
  const { activeDialect } = useDialect();
  return useMutation({
    mutationFn: async ({ occasionId, length = 8 }: { occasionId?: string; length?: number }) => {
      const { data, error } = await supabase.functions.invoke("generate-set-phrase-quiz", {
        body: { dialect: activeDialect, occasionId, length },
      });
      if (error) throw await toInvokeFailureError(error, data, "Couldn't load the quiz. Please try again.");
      return (data?.items ?? []) as QuizItem[];
    },
  });
};

export interface ChunkCoachResult {
  transcript: string;
  empty?: boolean;
  message?: string;
  used_chunk: boolean;
  understandable: boolean;
  natural: boolean;
  verdict: string;
  natural_rewrite: string;
  natural_rewrite_english: string;
  tips: string[];
  /** The FSRS grade for the phrase's production track — same bands as the
   *  exact-match scorer, so both paths grade one schedule consistently. */
  quality: number;
}

/**
 * Free-form chunk deployment: the learner answers the scenario in their own
 * words and the coach judges whether the chunk landed naturally — the harder
 * skill the verbatim scorer can't see.
 */
export const useChunkCoach = () => {
  return useMutation({
    mutationFn: async ({
      audioBase64,
      mimeType,
      phraseId,
    }: {
      audioBase64: string;
      mimeType: string;
      phraseId: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("practice-chunk-coach", {
        body: { audioBase64, mimeType, phraseId },
      });
      if (error) throw await toInvokeFailureError(error, data, "Coaching didn't work. Please try again.");
      return data as ChunkCoachResult;
    },
  });
};

export const useScoreVoice = () => {
  return useMutation({
    mutationFn: async ({
      audioBase64,
      mimeType,
      phraseId,
      target,
    }: {
      audioBase64: string;
      mimeType: string;
      phraseId: string;
      target: "phrase" | "reply";
    }) => {
      const { data, error } = await supabase.functions.invoke("score-set-phrase-voice", {
        body: { audioBase64, mimeType, phraseId, target },
      });
      if (error) throw await toInvokeFailureError(error, data, "Voice scoring didn't work. Please try again.");
      return data as {
        transcript: string;
        similarity: number;
        quality: number;
        accepted: boolean;
        canonical: string;
      };
    },
  });
};
