import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export interface TrendingTopic {
  id: string;
  platform: string;
  country: string;
  dialect: string;
  topic: string;
  rank: number | null;
  source_url: string | null;
  captured_on: string;
  captured_at: string;
}

/** What the askBrain screen recorded about a post (subset the UI shows). */
export interface ScreenInfo {
  register?: string;
  confidence?: number;
  reason?: string;
  outcome?: string;
  error?: string;
}

export interface SocialPost {
  id: string;
  platform: string;
  external_id: string;
  url: string | null;
  author: string | null;
  dialect: string;
  country: string | null;
  topic: string | null;
  arabic_text: string;
  translation: string | null;
  engagement: Json;
  screen: Json;
  status: string;
  posted_at: string | null;
  captured_at: string;
}

/**
 * Keep only each country's most recent harvest day, in rank order. The table
 * accumulates a row per (country, topic, day), so without this a country whose
 * harvest failed today would show yesterday's list twice while a healthy one
 * shows today's — per-country freshness keeps a partial outage partial.
 */
export function latestTopicsByCountry(rows: TrendingTopic[]): Map<string, TrendingTopic[]> {
  const byCountry = new Map<string, TrendingTopic[]>();
  for (const row of rows) {
    const list = byCountry.get(row.country) ?? [];
    list.push(row);
    byCountry.set(row.country, list);
  }
  for (const [country, list] of byCountry) {
    const latestDay = list.reduce((max, r) => (r.captured_on > max ? r.captured_on : max), "");
    byCountry.set(
      country,
      list
        .filter((r) => r.captured_on === latestDay)
        .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)),
    );
  }
  return byCountry;
}

function formatCompact(n: number): string {
  const fmt = (v: number) => v.toFixed(1).replace(/\.0$/, "");
  if (n >= 1e6) return `${fmt(n / 1e6)}M`;
  if (n >= 1e3) return `${fmt(n / 1e3)}K`;
  return String(n);
}

/**
 * One human-readable popularity line per post, in the platform's own currency:
 * Telegram counts views, Reddit counts upvotes. Empty string when the harvest
 * captured nothing, so cards omit the line instead of showing "0 views".
 */
export function engagementLabel(platform: string, engagement: Json): string {
  const e = (engagement ?? {}) as Record<string, unknown>;
  const num = (key: string): number | null => (typeof e[key] === "number" ? (e[key] as number) : null);
  if (platform === "telegram") {
    const views = num("views");
    return views ? `${formatCompact(views)} views` : "";
  }
  if (platform === "reddit") {
    const ups = num("ups");
    const comments = num("comments");
    if (ups === null) return "";
    return comments ? `${formatCompact(ups)} upvotes · ${formatCompact(comments)} comments` : `${formatCompact(ups)} upvotes`;
  }
  return "";
}

/** The screen verdict out of the jsonb blob, typed for display. */
export function screenInfo(post: SocialPost): ScreenInfo {
  return (post.screen ?? {}) as ScreenInfo;
}

/** Today's trend chips, one bundle per country, already rank-sorted. */
export function useTrendingTopics(dialect?: string) {
  return useQuery({
    queryKey: ["trending-topics", dialect ?? "All"],
    queryFn: async () => {
      let query = supabase
        .from("trending_topics")
        .select("*")
        .order("captured_on", { ascending: false })
        .order("rank", { ascending: true })
        .limit(200);
      if (dialect && dialect !== "All") query = query.eq("dialect", dialect);
      const { data, error } = await query;
      if (error) throw error;
      return latestTopicsByCountry((data ?? []) as unknown as TrendingTopic[]);
    },
  });
}

/**
 * The review-side post list. No implicit status filter: the admin page's tabs
 * pass one explicitly, and RLS restricts the whole table to content managers
 * anyway — this feature has no learner surface.
 */
export function useAdminSocialPosts(filters: {
  status?: string;
  dialect?: string;
  platform?: string;
}) {
  return useQuery({
    queryKey: ["admin-social-posts", filters],
    queryFn: async () => {
      let query = supabase
        .from("social_posts")
        .select("*")
        .order("captured_at", { ascending: false })
        .limit(100);
      if (filters.status && filters.status !== "All") {
        query = query.eq("status", filters.status);
      }
      if (filters.dialect && filters.dialect !== "All") {
        query = query.eq("dialect", filters.dialect);
      }
      if (filters.platform && filters.platform !== "All") {
        query = query.eq("platform", filters.platform);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as SocialPost[];
    },
  });
}

/**
 * The human verdict: a content manager approving or rejecting a screened post.
 * This write is the publisher now — the AI screen only fills the queue.
 */
export function useSetSocialPostStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const { error } = await supabase
        .from("social_posts")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-social-posts"] }),
  });
}

export interface HarvestSummary {
  topics?: number;
  telegramPosts?: number;
  redditPosts?: number;
  screenCalls?: number;
  allTargetsReached?: boolean;
  review?: Record<
    string,
    { target: number; have: number; screenedThisRun: Record<string, number>; queueEmpty: boolean }
  >;
}

/** Fire a harvest run from the admin page and hand back its summary. */
export function useRunSocialHarvest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<HarvestSummary>(
        "harvest-social-trends",
        { body: { platform: "all" } },
      );
      if (error) throw error;
      return (data ?? {}) as HarvestSummary;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-social-posts"] });
      qc.invalidateQueries({ queryKey: ["trending-topics"] });
    },
  });
}
