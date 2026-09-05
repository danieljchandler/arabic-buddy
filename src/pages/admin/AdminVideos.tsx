import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { usePipelineResume } from "@/hooks/usePipelineResume";
import { EdgeBuildBanner } from "@/components/admin/EdgeBuildBanner";
import {
  useAdminDiscoverVideos,
  useBackfillThumbnails,
  useDeleteDiscoverVideo,
  useReextractOnScreenText,
  useTogglePublish,
} from "@/hooks/useDiscoverVideos";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowLeft, Plus, Edit, Trash2, Eye, EyeOff, ImageDown, ScanText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDuration } from "@/lib/videoEmbed";
import { needsThumbnail } from "@/lib/thumbnailBackfill";
import { VideoThumbnail } from "@/components/media/VideoThumbnail";
import type { TranscriptLine } from "@/types/transcript";
import { cn } from "@/lib/utils";

type ReviewFilter = "all" | "needs_review" | "in_progress" | "done";

const FILTER_LABELS: Record<ReviewFilter, string> = {
  all: "All",
  needs_review: "Not started",
  in_progress: "Part-checked",
  done: "Fully checked",
};

interface ReviewMeta {
  /** Review-row count per video — how many lines carry a tick. */
  reviewCounts: Map<string, number>;
  /** Open (unresolved) comment count per video. */
  commentCounts: Map<string, number>;
}

/**
 * How much of each video a native speaker has checked, for the whole list.
 *
 * Folded in from the old /admin/transcribe queue. Fetched without an `.in()`
 * filter on purpose: the admin list is unbounded, and a hundred uuids in a
 * PostgREST query string is already ~4 KB of URL — two skinny full-table reads
 * are cheaper and simpler. Errors are swallowed rather than thrown: if the
 * counts cannot be read, the list still manages videos, which is most of its
 * value.
 */
function useReviewMeta() {
  return useQuery({
    queryKey: ["admin-video-review-counts"],
    queryFn: async (): Promise<ReviewMeta> => {
      const [{ data: reviews }, { data: comments }] = await Promise.all([
        supabase.from("transcript_line_reviews").select("video_id, line_id"),
        supabase.from("transcript_line_comments").select("video_id, resolved_at"),
      ]);

      const reviewCounts = new Map<string, number>();
      for (const row of reviews ?? []) {
        reviewCounts.set(row.video_id, (reviewCounts.get(row.video_id) ?? 0) + 1);
      }
      const commentCounts = new Map<string, number>();
      for (const row of comments ?? []) {
        if (row.resolved_at) continue;
        commentCounts.set(row.video_id, (commentCounts.get(row.video_id) ?? 0) + 1);
      }
      return { reviewCounts, commentCounts };
    },
  });
}

const AdminVideos = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: videos, isLoading } = useAdminDiscoverVideos();
  const { data: reviewMeta } = useReviewMeta();
  const deleteMutation = useDeleteDiscoverVideo();
  const togglePublish = useTogglePublish();
  const backfillThumbnails = useBackfillThumbnails();
  const reextractOnScreenText = useReextractOnScreenText();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rereadingId, setRereadingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [search, setSearch] = useState("");

  /**
   * Whether this person manages videos or only reviews their transcripts.
   *
   * A transcriber — a native speaker checking the AI's Arabic, not a member of
   * staff — reaches this list too now that the review workspace lives on the
   * edit page. RLS is what actually stops them writing; hiding the publish,
   * delete and pipeline controls stops the page offering buttons that would
   * only ever error. False until roles load, so nothing flashes.
   */
  const { isAdmin, isContentReviewer, loading: rolesLoading } = useAdminAuth();
  // Not recorders: RLS grants discover_videos writes to can_manage_content()
  // (admin | content_reviewer) only, and hides unpublished rows from them.
  // Including them here offered publish/delete buttons whose writes matched
  // zero rows and "succeeded".
  const canManage = !rolesLoading && (isAdmin || isContentReviewer);

  // The list polls while any video is mid-run; a row that has stopped moving
  // is a run whose worker died, and this asks the pipeline to pick it up from
  // its checkpoint rather than leaving it for the reaper to fail.
  usePipelineResume(videos, { enabled: canManage });

  /**
   * Re-read one video's on-screen text.
   *
   * Worth surfacing per row rather than as a bulk action: it costs a video
   * download and a vision call each time, and the videos that need it are the
   * ones an admin has just noticed are missing their captions.
   */
  const rereadScreenText = (videoId: string) => {
    setRereadingId(videoId);
    reextractOnScreenText.mutate(videoId, {
      onSuccess: (result) => {
        const found = result.onScreenTextCount ?? 0;
        const removed = result.removedTranscriptLines ?? 0;
        toast({
          title: found
            ? `Read ${found} line${found === 1 ? "" : "s"} of on-screen text`
            : "No on-screen text found",
          description: removed
            ? `Also moved ${removed} caption${removed === 1 ? "" : "s"} out of the spoken transcript.`
            : found
              ? undefined
              : "Nothing readable was written on this video's frames.",
        });
      },
      onError: (error: Error) => {
        toast({ variant: "destructive", title: "Could not re-read the video", description: error.message });
      },
      onSettled: () => setRereadingId(null),
    });
  };

  /**
   * The videos showing no picture — now, or in two days' time.
   *
   * Not simply "thumbnail_url is null". A YouTube still is derived from the
   * row's own URL, so most rows with an empty column already show something
   * and there is nothing to go and fetch for them. And a row that *has* a
   * TikTok still may be the worst case of the lot: what the platform hands
   * out is signed and expires in about forty-eight hours, so it looks fine on
   * the day it is added and is blank by the time anyone scrolls past it.
   */
  const missingThumbnails = (videos ?? []).filter(needsThumbnail);

  const runBackfill = () => {
    backfillThumbnails.mutate(
      { videos: missingThumbnails },
      {
        onSuccess: (report) => {
          const unresolved = report.unresolved.length + report.failedToSave.length;
          toast({
            title: report.filled
              ? `Found ${report.filled} thumbnail${report.filled === 1 ? "" : "s"}`
              : "No thumbnails could be found",
            description: unresolved
              ? `${unresolved} still need a frame captured — open the video and use "Fetch thumbnail".`
              : undefined,
          });
        },
        onError: (error: Error) => {
          toast({ variant: "destructive", title: "Backfill failed", description: error.message });
        },
      },
    );
  };

  /** Each video plus what the review layer knows about it. */
  const rows = useMemo(() => {
    return (videos ?? []).map((video) => {
      const lines = (video.transcript_lines as unknown as TranscriptLine[]) ?? [];
      return {
        video,
        lineCount: lines.length,
        reviewedCount: reviewMeta?.reviewCounts.get(video.id) ?? 0,
        // The translation ensemble's own doubt: lines where its models
        // disagreed. The best place for a native speaker to start.
        flaggedCount: lines.filter((line) => line.needs_review).length,
        openComments: reviewMeta?.commentCounts.get(video.id) ?? 0,
      };
    });
  }, [videos, reviewMeta]);

  const counts = useMemo(() => {
    const reviewable = rows.filter((row) => row.lineCount > 0);
    return {
      all: rows.length,
      needs_review: reviewable.filter((r) => r.reviewedCount === 0).length,
      in_progress: reviewable.filter(
        (r) => r.reviewedCount > 0 && r.reviewedCount < r.lineCount,
      ).length,
      done: reviewable.filter((r) => r.reviewedCount >= r.lineCount).length,
    } satisfies Record<ReviewFilter, number>;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const matching = search.trim()
      ? rows.filter((row) =>
          row.video.title.toLowerCase().includes(search.trim().toLowerCase()),
        )
      : rows;

    if (filter === "all") return matching;

    const byFilter = matching
      .filter((row) => row.lineCount > 0)
      .filter((row) => {
        switch (filter) {
          case "needs_review":
            return row.reviewedCount === 0;
          case "in_progress":
            return row.reviewedCount > 0 && row.reviewedCount < row.lineCount;
          case "done":
            return row.reviewedCount >= row.lineCount;
          default:
            return true;
        }
      });

    // Under a review filter, sorted by how much is left rather than by date: a
    // video where one line is outstanding should be finishable in a minute,
    // and burying it under a fresh-off-the-pipeline hour of audio is how it
    // stays outstanding for a month.
    return [...byFilter].sort((a, b) => {
      const left = a.lineCount - a.reviewedCount;
      const right = b.lineCount - b.reviewedCount;
      if (left === 0 && right !== 0) return 1;
      if (right === 0 && left !== 0) return -1;
      return left - right;
    });
  }, [rows, filter, search]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold">Manage Videos</h1>
          </div>
          {canManage && (
            <div className="flex gap-2">
              {/* Only offered when there is something to do — the count is the
                  whole point of the button, so a zero would be a dead control. */}
              {missingThumbnails.length > 0 && (
                <Button
                  variant="outline"
                  onClick={runBackfill}
                  disabled={backfillThumbnails.isPending}
                >
                  {backfillThumbnails.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <ImageDown className="h-4 w-4 mr-2" />
                  )}
                  Find {missingThumbnails.length} missing thumbnail
                  {missingThumbnails.length === 1 ? "" : "s"}
                </Button>
              )}
              <Button onClick={() => navigate("/admin/videos/new")}>
                <Plus className="h-4 w-4 mr-2" />
                Add Video
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-4">
        {/* Deployed-backend check: see EdgeBuildBanner. First thing on the page
            because a stale backend makes everything below it misleading. */}
        <EdgeBuildBanner enabled={canManage} />

        {/* The review queue's lens over the same list: how much of each video a
            native speaker has actually checked. */}
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(FILTER_LABELS) as ReviewFilter[]).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={filter === option ? "default" : "outline"}
              onClick={() => setFilter(option)}
            >
              {FILTER_LABELS[option]}
              <span className="ml-1.5 tabular-nums opacity-70">{counts[option]}</span>
            </Button>
          ))}
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search titles"
            className="ml-auto w-48"
            aria-label="Search videos"
          />
        </div>

        {videos && videos.length > 0 ? (
          <div className="space-y-3">
            {visibleRows.length === 0 && (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Nothing here. Try another filter.
              </p>
            )}
            {visibleRows.map(({ video, lineCount, reviewedCount, flaggedCount, openComments }) => {
              const percent = lineCount === 0 ? 0 : Math.round((reviewedCount / lineCount) * 100);
              return (
              <Card
                key={video.id}
                className="flex items-center cursor-pointer transition-colors hover:border-blue-400"
                onClick={() => navigate(`/admin/videos/${video.id}/edit`)}
              >
                <CardContent className="flex-1 p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-4">
                    <VideoThumbnail
                      src={video.thumbnail_url}
                      sources={video}
                      alt=""
                      decorative
                      className="w-20 h-12 rounded"
                      // Keeps the row aligned with its neighbours, and marks
                      // the videos a still could not be derived for.
                      fallback={<div className="w-20 h-12 rounded bg-muted" />}
                    />
                    <div>
                      <h3 className="font-semibold">{video.title}</h3>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        <Badge variant="outline" className="text-xs">{video.dialect}</Badge>
                        <Badge variant="outline" className="text-xs">{video.difficulty}</Badge>
                        <Badge variant="outline" className="text-xs capitalize">{video.platform}</Badge>
                        {video.duration_seconds && (
                          <Badge variant="outline" className="text-xs">
                            {formatDuration(video.duration_seconds)}
                          </Badge>
                        )}
                        <Badge variant={video.published ? "default" : "secondary"} className="text-xs">
                          {video.published ? "Published" : "Draft"}
                        </Badge>
                        {video.transcription_status === 'pending' && (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                            Queued
                          </Badge>
                        )}
                        {video.transcription_status === 'processing' && (
                          <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Transcribing
                          </Badge>
                        )}
                        {video.transcription_status === 'analysis_complete' && (
                          <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Finalizing
                          </Badge>
                        )}
                        {video.transcription_status === 'failed' && (
                          <Badge variant="destructive" className="text-xs">
                            Failed
                          </Badge>
                        )}
                        {video.transcription_status === 'completed' && !video.published && (
                          <Badge variant="outline" className="text-xs text-green-600 border-green-300">
                            Ready to review
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {flaggedCount > 0 && (
                      <span
                        className="rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                        title="Lines the translation ensemble was unsure about"
                      >
                        {flaggedCount} uncertain
                      </span>
                    )}
                    {openComments > 0 && (
                      <span className="rounded bg-sky-100 px-2 py-0.5 text-[11px] text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">
                        💬 {openComments}
                      </span>
                    )}
                    {lineCount > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {reviewedCount}/{lineCount}
                        </span>
                        <div className="h-2 w-24 overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
                          <div
                            className={cn(
                              "h-full rounded",
                              percent === 100 ? "bg-green-500" : "bg-blue-500",
                            )}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* The buttons must not also open the editor. */}
                    {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                      {canManage && (
                        <>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              togglePublish.mutate(
                                { id: video.id, published: !video.published },
                                {
                                  onSuccess: () =>
                                    toast({
                                      title: video.published ? "Unpublished" : "Published",
                                    }),
                                  onError: (err: Error) =>
                                    toast({
                                      variant: "destructive",
                                      title: "Error",
                                      description: err.message,
                                    }),
                                }
                              )
                            }
                          >
                            {video.published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            title="Re-read the text on this video's screen"
                            aria-label="Re-read the text on this video's screen"
                            disabled={rereadingId !== null}
                            onClick={() => rereadScreenText(video.id)}
                          >
                            {rereadingId === video.id
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <ScanText className="h-4 w-4" />}
                          </Button>
                        </>
                      )}
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Edit ${video.title}`}
                        onClick={() => navigate(`/admin/videos/${video.id}/edit`)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      {canManage && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(video.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground mb-4">No videos yet. Add your first video!</p>
              {canManage && (
                <Button onClick={() => navigate("/admin/videos/new")}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Video
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Video?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this video. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteId) {
                  deleteMutation.mutate(deleteId, {
                    onSuccess: () => {
                      toast({ title: "Video deleted" });
                      setDeleteId(null);
                    },
                    onError: (err: Error) => {
                      toast({ variant: "destructive", title: "Error", description: err.message });
                    },
                  });
                }
              }}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminVideos;
