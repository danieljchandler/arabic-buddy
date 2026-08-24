import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useDialect } from "@/contexts/DialectContext";
import type { TranscriptLine } from "@/types/transcript";
import { cn } from "@/lib/utils";

type Filter = "needs_review" | "in_progress" | "done" | "all";

const FILTER_LABELS: Record<Filter, string> = {
  needs_review: "Not started",
  in_progress: "Part-checked",
  done: "Fully checked",
  all: "All",
};

interface QueueRow {
  id: string;
  title: string;
  dialect: string;
  difficulty: string;
  published: boolean;
  lineCount: number;
  reviewedCount: number;
  flaggedCount: number;
  openComments: number;
}

/**
 * What is waiting to be checked.
 *
 * Sorted by how much is left rather than by date: a video where one line is
 * outstanding should be finishable in a minute, and burying it under a
 * fresh-off-the-pipeline hour of audio is how it stays outstanding for a month.
 */
export default function AdminTranscribeQueue() {
  const navigate = useNavigate();
  const { activeDialect } = useDialect();
  const [filter, setFilter] = useState<Filter>("needs_review");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["transcribe-queue", activeDialect],
    queryFn: async (): Promise<QueueRow[]> => {
      const { data: videos, error } = await supabase
        .from("discover_videos")
        .select("id, title, dialect, difficulty, published, transcript_lines")
        .eq("dialect", activeDialect)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;

      const ids = (videos ?? []).map((v) => v.id);
      if (ids.length === 0) return [];

      // Two extra round-trips rather than a join: the review tables key on a
      // line id inside a jsonb array, so there is no foreign key for PostgREST
      // to embed on.
      const [{ data: reviews }, { data: comments }] = await Promise.all([
        supabase.from("transcript_line_reviews").select("video_id, line_id").in("video_id", ids),
        supabase
          .from("transcript_line_comments")
          .select("video_id, resolved_at")
          .in("video_id", ids),
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

      return (videos ?? []).map((video) => {
        const lines = (video.transcript_lines as unknown as TranscriptLine[]) ?? [];
        return {
          id: video.id,
          title: video.title,
          dialect: video.dialect,
          difficulty: video.difficulty,
          published: video.published,
          lineCount: lines.length,
          reviewedCount: reviewCounts.get(video.id) ?? 0,
          // The translation ensemble's own doubt: lines where its models
          // disagreed. The best place for a native speaker to start.
          flaggedCount: lines.filter((line) => line.needs_review).length,
          openComments: commentCounts.get(video.id) ?? 0,
        };
      });
    },
  });

  const rows = useMemo(() => {
    const all = (data ?? []).filter((row) => row.lineCount > 0);
    const matching = search.trim()
      ? all.filter((row) => row.title.toLowerCase().includes(search.trim().toLowerCase()))
      : all;

    const byFilter = matching.filter((row) => {
      switch (filter) {
        case "needs_review":
          return row.reviewedCount === 0;
        case "in_progress":
          return row.reviewedCount > 0 && row.reviewedCount < row.lineCount;
        case "done":
          return row.reviewedCount >= row.lineCount;
        case "all":
        default:
          return true;
      }
    });

    return byFilter.sort((a, b) => {
      const left = a.lineCount - a.reviewedCount;
      const right = b.lineCount - b.reviewedCount;
      // Finished videos sink; among the rest, the nearly-done float up.
      if (left === 0 && right !== 0) return 1;
      if (right === 0 && left !== 0) return -1;
      return left - right;
    });
  }, [data, filter, search]);

  const counts = useMemo(() => {
    const all = (data ?? []).filter((row) => row.lineCount > 0);
    return {
      needs_review: all.filter((r) => r.reviewedCount === 0).length,
      in_progress: all.filter((r) => r.reviewedCount > 0 && r.reviewedCount < r.lineCount).length,
      done: all.filter((r) => r.reviewedCount >= r.lineCount).length,
      all: all.length,
    } satisfies Record<Filter, number>;
  }, [data]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">Transcription review</h1>
        <p className="text-sm text-muted-foreground">
          Check the AI's Arabic and English against what is actually said. {activeDialect} videos.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((option) => (
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

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nothing here. Try another filter.
        </p>
      )}

      <div className="space-y-2">
        {rows.map((row) => {
          const percent =
            row.lineCount === 0 ? 0 : Math.round((row.reviewedCount / row.lineCount) * 100);
          return (
            <Card
              key={row.id}
              className="cursor-pointer transition-colors hover:border-blue-400"
              onClick={() => navigate(`/admin/transcribe/${row.id}`)}
            >
              <CardContent className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.lineCount} lines · {row.difficulty}
                    {row.published ? " · published" : ""}
                  </p>
                </div>

                {row.flaggedCount > 0 && (
                  <span
                    className="rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                    title="Lines the translation ensemble was unsure about"
                  >
                    {row.flaggedCount} uncertain
                  </span>
                )}
                {row.openComments > 0 && (
                  <span className="rounded bg-sky-100 px-2 py-0.5 text-[11px] text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">
                    💬 {row.openComments}
                  </span>
                )}

                <div className="flex items-center gap-2">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {row.reviewedCount}/{row.lineCount}
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
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
