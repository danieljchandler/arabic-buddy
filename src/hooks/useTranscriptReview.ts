import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { indexReviews, type LineReview } from "@/lib/reviewStatus";
import type { TranscriptLine } from "@/types/transcript";

/**
 * The review workspace's data layer: what has been signed off, what changed,
 * and what people said about it.
 *
 * Reads come straight from the tables under RLS; every write goes through the
 * `transcript-review` edge function. That split is not incidental — see the
 * header of supabase/functions/transcript-review/index.ts. The short version is
 * that a reviewer must not be able to author their own audit trail, so the
 * before/after in a revision row is computed server-side against what is
 * actually stored, and the reviewer's identity comes from their token.
 */

export interface TranscriptRevisionRow {
  id: string;
  lineId: string | null;
  field: string;
  previousValue: string | null;
  newValue: string | null;
  changedBy: string | null;
  changedAt: string;
  source: "human" | "ai_retranslate" | "ai_resegment";
}

export interface TranscriptCommentRow {
  id: string;
  lineId: string | null;
  kind: "comment" | "suggestion" | "concern";
  body: string;
  suggestedTranslation: string | null;
  authorId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** What the edge function answers with when something goes wrong. */
interface FunctionError {
  error?: string;
  message?: string;
}

/**
 * What the edge function actually said, rather than what supabase-js says.
 *
 * The client raises `FunctionsHttpError` with the same fixed message for every
 * non-2xx, so a 403 "you are not a reviewer" and a 502 "the model timed out"
 * reach the screen identically. The real status and body live on
 * `error.context` — the same shape `AdminTranscriptEditor` unpacks.
 */
async function describeFunctionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx === "object" && "status" in ctx) {
    const response = ctx as Response;
    try {
      const body = (await response.clone().json()) as FunctionError;
      const detail = body.message || body.error;
      if (detail) return `${response.status}: ${detail}`;
    } catch {
      /* not JSON — the status still beats the generic message */
    }
    return `The server returned ${response.status}.`;
  }
  return (error as { message?: string } | null)?.message ?? "Unknown error";
}

async function callReview<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("transcript-review", { body });
  if (error) throw new Error(await describeFunctionError(error));
  return data as T;
}

export function useTranscriptReview(videoId: string | undefined) {
  const queryClient = useQueryClient();
  const enabled = Boolean(videoId);

  const reviewsQuery = useQuery({
    queryKey: ["transcript-reviews", videoId],
    enabled,
    queryFn: async (): Promise<LineReview[]> => {
      const { data, error } = await supabase
        .from("transcript_line_reviews")
        .select("line_id, reviewed_by, reviewed_at, reviewed_arabic, reviewed_translation")
        .eq("video_id", videoId!);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        lineId: row.line_id,
        reviewedBy: row.reviewed_by,
        reviewedAt: row.reviewed_at,
        reviewedArabic: row.reviewed_arabic,
        reviewedTranslation: row.reviewed_translation,
      }));
    },
  });

  const revisionsQuery = useQuery({
    queryKey: ["transcript-revisions", videoId],
    enabled,
    queryFn: async (): Promise<TranscriptRevisionRow[]> => {
      const { data, error } = await supabase
        .from("transcript_line_revisions")
        .select("id, line_id, field, previous_value, new_value, changed_by, changed_at, source")
        .eq("video_id", videoId!)
        .order("changed_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        lineId: row.line_id,
        field: row.field,
        previousValue: row.previous_value,
        newValue: row.new_value,
        changedBy: row.changed_by,
        changedAt: row.changed_at,
        source: row.source as TranscriptRevisionRow["source"],
      }));
    },
  });

  const commentsQuery = useQuery({
    queryKey: ["transcript-comments", videoId],
    enabled,
    queryFn: async (): Promise<TranscriptCommentRow[]> => {
      const { data, error } = await supabase
        .from("transcript_line_comments")
        .select(
          "id, line_id, kind, body, suggested_translation, author_id, created_at, resolved_at",
        )
        .eq("video_id", videoId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        lineId: row.line_id,
        kind: row.kind as TranscriptCommentRow["kind"],
        body: row.body,
        suggestedTranslation: row.suggested_translation,
        authorId: row.author_id,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
      }));
    },
  });

  const invalidate = useCallback(
    (...keys: string[]) => {
      for (const key of keys) {
        void queryClient.invalidateQueries({ queryKey: [key, videoId] });
      }
    },
    [queryClient, videoId],
  );

  const setReviewed = useMutation({
    mutationFn: (vars: { lineId: string; reviewed: boolean }) =>
      callReview<{ reviewed: boolean }>({
        action: "set_reviewed",
        videoId,
        lineId: vars.lineId,
        reviewed: vars.reviewed,
      }),
    onSuccess: () => invalidate("transcript-reviews"),
  });

  const saveLines = useMutation({
    mutationFn: (vars: { lines: TranscriptLine[]; source?: "human" | "ai_resegment" }) =>
      callReview<{ saved: boolean; revisions: number; logged: boolean }>({
        action: "save_lines",
        videoId,
        lines: vars.lines,
        source: vars.source ?? "human",
      }),
    // The tick snapshots go stale as a side effect of a save, so the review
    // query has to be refetched alongside the revision log.
    onSuccess: () => invalidate("transcript-revisions", "transcript-reviews"),
  });

  const retranslateLine = useMutation({
    mutationFn: (vars: { lineId: string }) =>
      callReview<{ translation: string; literal: string | null }>({
        action: "retranslate_line",
        videoId,
        lineId: vars.lineId,
      }),
    onSuccess: () => invalidate("transcript-revisions", "transcript-reviews"),
  });

  const addComment = useMutation({
    mutationFn: (vars: {
      lineId?: string | null;
      body: string;
      kind?: TranscriptCommentRow["kind"];
      suggestedTranslation?: string;
    }) =>
      callReview<{ comment: unknown }>({
        action: "add_comment",
        videoId,
        lineId: vars.lineId ?? null,
        body: vars.body,
        kind: vars.kind ?? "comment",
        suggestedTranslation: vars.suggestedTranslation ?? "",
      }),
    onSuccess: () => invalidate("transcript-comments"),
  });

  const resolveComment = useMutation({
    mutationFn: (vars: { commentId: string; resolved: boolean }) =>
      callReview<{ resolved: boolean }>({
        action: "resolve_comment",
        commentId: vars.commentId,
        resolved: vars.resolved,
      }),
    onSuccess: () => invalidate("transcript-comments"),
  });

  const saveNotes = useMutation({
    mutationFn: (vars: {
      culturalContext?: string;
      grammarPoints?: unknown[];
      vocabulary?: unknown[];
      /** The country-level label. Refused server-side if it is not a known one. */
      dialect?: string;
      /** Cleared server-side if it does not belong under `dialect`. */
      dialectSubvariety?: string | null;
      dialectFeatures?: unknown[];
    }) => callReview<{ saved: boolean; revisions: number }>({ action: "save_notes", videoId, ...vars }),
    // The dialect columns live on `discover_videos`, which this hook does not
    // own — the workspace refetches its own video query on success, the same
    // way it already does for the notes.
    onSuccess: () => invalidate("transcript-revisions"),
  });

  const reviews = useMemo(
    () => indexReviews(reviewsQuery.data ?? []),
    [reviewsQuery.data],
  );

  const revisionsByLine = useMemo(() => {
    const map = new Map<string, TranscriptRevisionRow[]>();
    for (const revision of revisionsQuery.data ?? []) {
      if (!revision.lineId) continue;
      const list = map.get(revision.lineId);
      if (list) list.push(revision);
      else map.set(revision.lineId, [revision]);
    }
    return map;
  }, [revisionsQuery.data]);

  const commentsByLine = useMemo(() => {
    const map = new Map<string, TranscriptCommentRow[]>();
    for (const comment of commentsQuery.data ?? []) {
      if (!comment.lineId) continue;
      const list = map.get(comment.lineId);
      if (list) list.push(comment);
      else map.set(comment.lineId, [comment]);
    }
    return map;
  }, [commentsQuery.data]);

  /** Lines carrying at least one comment nobody has closed off yet. */
  const openCommentLineIds = useMemo(() => {
    const ids = new Set<string>();
    for (const comment of commentsQuery.data ?? []) {
      if (comment.lineId && !comment.resolvedAt) ids.add(comment.lineId);
    }
    return ids;
  }, [commentsQuery.data]);

  return {
    reviews,
    revisions: revisionsQuery.data ?? [],
    revisionsByLine,
    comments: commentsQuery.data ?? [],
    commentsByLine,
    openCommentLineIds,
    loading: reviewsQuery.isLoading || commentsQuery.isLoading,
    setReviewed,
    saveLines,
    retranslateLine,
    addComment,
    resolveComment,
    saveNotes,
  };
}
