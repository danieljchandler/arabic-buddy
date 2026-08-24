import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminTranscriptEditor } from "@/components/admin/AdminTranscriptEditor";
import LineRevisionHistory from "@/components/admin/transcribe/LineRevisionHistory";
import LineComments from "@/components/admin/transcribe/LineComments";
import VideoNotesEditor, {
  type GrammarPoint,
  type VocabEntry,
} from "@/components/admin/transcribe/VideoNotesEditor";
import type { LineReviewSlot } from "@/components/TranscriptEditor";
import { useTranscriptReview } from "@/hooks/useTranscriptReview";
import { reviewProgress, reviewStateFor } from "@/lib/reviewStatus";
import { resolveStagedVideoAudioUrl } from "@/lib/videoAudioStaging";
import type { TranscriptLine } from "@/types/transcript";
import { cn } from "@/lib/utils";

/**
 * The native-speaker review workspace.
 *
 * The one page a transcriber can reach, so everything their job needs is on it:
 * the lines with their audio, the checkmarks, the change log, the comment
 * threads, and the video's cultural and grammar notes. It is deliberately not
 * the admin video form — that page can publish, delete and re-run the
 * pipeline, none of which a reviewer should be one misclick away from.
 */
export default function AdminTranscribeWorkspace() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();

  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | undefined>();
  const [detailLineId, setDetailLineId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"history" | "comments">("comments");
  const [retranslating, setRetranslating] = useState<string | null>(null);

  const videoQuery = useQuery({
    queryKey: ["transcribe-video", videoId],
    enabled: Boolean(videoId),
    queryFn: async () => {
      // One literal, not a concatenation: supabase-js resolves the row type
      // from the select string's *literal type*, and `"a, " + "b"` widens to
      // plain `string`, which lands the whole query on GenericStringError.
      const { data, error } = await supabase
        .from("discover_videos")
        .select("id, title, title_arabic, dialect, difficulty, published, source_url, embed_url, transcript_lines, cultural_context, grammar_points, vocabulary, transcription_status")
        .eq("id", videoId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const video = videoQuery.data;
  const review = useTranscriptReview(videoId);

  // Seed the editor once the video arrives. Later refetches must not clobber
  // in-progress edits, so this keys on the video id rather than on the data.
  useEffect(() => {
    if (!video) return;
    setLines(((video.transcript_lines as unknown as TranscriptLine[]) ?? []).slice());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id]);

  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    void resolveStagedVideoAudioUrl(videoId).then((url) => {
      if (!cancelled && url) setAudioUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  const progress = useMemo(
    () => reviewProgress(lines.map((l) => ({ id: l.id, arabic: l.arabic, translation: l.translation })), review.reviews),
    [lines, review.reviews],
  );

  /**
   * Persist the transcript.
   *
   * The editor debounces and hands back the whole list, so this is called on
   * every settled keystroke. The diff — and therefore the log — is computed on
   * the server against what is stored, so saving an unchanged transcript
   * records nothing.
   */
  /**
   * The save the editor last asked for, so anything that reads the transcript
   * back off the server can wait for it to land first.
   */
  const inFlightSave = useRef<Promise<unknown>>(Promise.resolve());

  const handleLinesChange = useCallback(
    (next: TranscriptLine[]) => {
      setLines(next);
      inFlightSave.current = review.saveLines.mutateAsync({ lines: next }).catch((error) => {
        toast({
          title: "Could not save",
          description: (error as Error).message,
          variant: "destructive",
        });
      });
    },
    [review.saveLines],
  );

  const handleRetranslate = useCallback(
    async (lineId: string) => {
      setRetranslating(lineId);
      // The editor flushes its pending save before calling this, so awaiting it
      // is what guarantees the server re-translates the corrected Arabic rather
      // than the version it replaced.
      await inFlightSave.current;
      review.retranslateLine.mutate(
        { lineId },
        {
          onSuccess: (data) => {
            setLines((prev) =>
              prev.map((line) =>
                line.id === lineId
                  ? { ...line, translation: data.translation, literal: data.literal ?? line.literal }
                  : line,
              ),
            );
            toast({ title: "Re-translated", description: data.translation });
          },
          onError: (error: unknown) =>
            toast({
              title: "Re-translation failed",
              description: (error as Error).message,
              variant: "destructive",
            }),
          onSettled: () => setRetranslating(null),
        },
      );
    },
    [review.retranslateLine],
  );

  const openDetail = useCallback((lineId: string, tab: "history" | "comments") => {
    setDetailLineId(lineId);
    setDetailTab(tab);
  }, []);

  // Destructured rather than closed over as `review`, which is a fresh object
  // every render: this callback reaches every card in the list and re-binds the
  // editor's keydown listener, and a four-hundred-line transcript is exactly
  // where that churn would be felt.
  const { reviews, commentsByLine, revisionsByLine, setReviewed } = review;

  const lineReview = useCallback(
    (lineId: string): LineReviewSlot | undefined => {
      const line = lines.find((l) => l.id === lineId);
      if (!line) return undefined;
      const row = reviews.get(lineId);
      return {
        state: reviewStateFor(row, line),
        reviewedAt: row?.reviewedAt,
        // Set by the translation ensemble when its models disagreed, or when
        // nothing settled the line. A different question from whether a person
        // has looked at it, and the best place for one to start.
        flagged: line.needs_review === true,
        flagReason: line.review_reason,
        openComments: (commentsByLine.get(lineId) ?? []).filter((c) => !c.resolvedAt).length,
        revisions: (revisionsByLine.get(lineId) ?? []).length,
        onToggleReviewed: () =>
          setReviewed.mutate(
            // A stale tick is re-confirmed rather than cleared: the reviewer has
            // just looked at the new text, which is the whole point of the
            // prompt to look again.
            { lineId, reviewed: reviewStateFor(row, line) !== "reviewed" },
            {
              onError: (error: unknown) =>
                toast({
                  title: "Could not record the review",
                  description: (error as Error).message,
                  variant: "destructive",
                }),
            },
          ),
        onOpenComments: () => openDetail(lineId, "comments"),
        onOpenHistory: () => openDetail(lineId, "history"),
      };
    },
    [commentsByLine, lines, openDetail, reviews, revisionsByLine, setReviewed],
  );

  const detailLine = lines.find((l) => l.id === detailLineId);
  const detailIndex = lines.findIndex((l) => l.id === detailLineId);

  const applySuggestion = useCallback(
    (suggestion: string) => {
      if (!detailLineId) return;
      const next = lines.map((line) =>
        line.id === detailLineId ? { ...line, translation: suggestion } : line,
      );
      handleLinesChange(next);
      toast({ title: "Translation updated" });
    },
    [detailLineId, handleLinesChange, lines],
  );

  if (videoQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!video) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">That video could not be found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/admin/transcribe")}>
          Back to the queue
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/transcribe")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Queue
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{video.title}</h1>
          <p className="text-xs text-muted-foreground">
            {video.dialect} · {video.difficulty}
            {video.published ? " · published" : " · not published"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-right">
            <p className="text-sm font-medium tabular-nums">
              {progress.reviewed} / {progress.total} lines checked
            </p>
            {progress.stale > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {progress.stale} changed since being checked
              </p>
            )}
          </div>
          <div className="h-2 w-28 overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
            <div
              className={cn(
                "h-full rounded transition-all",
                progress.percent === 100 ? "bg-green-500" : "bg-blue-500",
              )}
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      </div>

      {/*
        The pipeline rewrites `transcript_lines` wholesale when it finishes, so
        anything corrected while it is mid-run is about to be thrown away. Worth
        saying before the reviewer spends an hour on it rather than after.
      */}
      {(video.transcription_status === "processing" ||
        video.transcription_status === "pending") && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
          This video is still being transcribed. Anything you correct now will be overwritten
          when the pipeline finishes — come back once it is done.
        </p>
      )}

      {!audioUrl && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          No audio is staged for this video, so the per-line playback controls have nothing to
          play. The transcript can still be corrected.
        </p>
      )}

      <Tabs defaultValue="transcript">
        <TabsList>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="notes">Notes &amp; grammar</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="transcript" className="mt-4">
          {retranslating && (
            <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Re-translating…
            </p>
          )}
          <AdminTranscriptEditor
            lines={lines}
            onChange={handleLinesChange}
            audioUrl={audioUrl}
            lineReview={lineReview}
            onRetranslate={handleRetranslate}
          />
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <VideoNotesEditor
            culturalContext={video.cultural_context ?? ""}
            grammarPoints={(video.grammar_points as unknown as GrammarPoint[]) ?? []}
            vocabulary={(video.vocabulary as unknown as VocabEntry[]) ?? []}
            busy={review.saveNotes.isPending}
            onSave={(input) =>
              review.saveNotes.mutateAsync(input).then(
                () => {
                  toast({ title: "Notes saved" });
                  void videoQuery.refetch();
                },
                (error: unknown) =>
                  toast({
                    title: "Could not save the notes",
                    description: (error as Error).message,
                    variant: "destructive",
                  }),
              )
            }
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Everything that changed</CardTitle>
            </CardHeader>
            <CardContent>
              <LineRevisionHistory
                revisions={review.revisions}
                emptyLabel="Nothing has been changed on this video yet."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Notes about the whole video</CardTitle>
            </CardHeader>
            <CardContent>
              <LineComments
                comments={review.comments.filter((c) => !c.lineId)}
                busy={review.addComment.isPending}
                onAdd={(input) => review.addComment.mutateAsync({ ...input, lineId: null })}
                onResolve={(commentId, resolved) =>
                  review.resolveComment.mutate({ commentId, resolved })
                }
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={detailLineId !== null} onOpenChange={(open) => !open && setDetailLineId(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Line {detailIndex + 1}</DialogTitle>
          </DialogHeader>

          {detailLine && (
            <>
              <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <p dir="rtl" className="text-right font-cairo text-base">
                  {detailLine.arabic}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{detailLine.translation}</p>
              </div>

              <Tabs value={detailTab} onValueChange={(v) => setDetailTab(v as "history" | "comments")}>
                <TabsList>
                  <TabsTrigger value="comments">Comments</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>

                <TabsContent value="comments" className="mt-3">
                  <LineComments
                    comments={review.commentsByLine.get(detailLine.id) ?? []}
                    busy={review.addComment.isPending}
                    onAdd={(input) =>
                      review.addComment.mutateAsync({ ...input, lineId: detailLine.id })
                    }
                    onResolve={(commentId, resolved) =>
                      review.resolveComment.mutate({ commentId, resolved })
                    }
                    onApplySuggestion={applySuggestion}
                  />
                </TabsContent>

                <TabsContent value="history" className="mt-3">
                  <LineRevisionHistory
                    revisions={review.revisionsByLine.get(detailLine.id) ?? []}
                    emptyLabel="This line has not been changed since it was transcribed."
                  />
                </TabsContent>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
