import { useQuery } from "@tanstack/react-query";
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
 * The screened feed. RLS already hides non-approved rows from learners, but
 * the filter is stated here too so the query means what the page shows even
 * when a content manager (whose RLS lets pending rows through) is looking.
 */
export function useSocialPosts(filters?: { dialect?: string; platform?: string }) {
  return useQuery({
    queryKey: ["social-posts", filters ?? {}],
    queryFn: async () => {
      let query = supabase
        .from("social_posts")
        .select("*")
        .eq("status", "approved")
        .order("captured_at", { ascending: false })
        .limit(60);
      if (filters?.dialect && filters.dialect !== "All") {
        query = query.eq("dialect", filters.dialect);
      }
      if (filters?.platform && filters.platform !== "All") {
        query = query.eq("platform", filters.platform);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as SocialPost[];
    },
  });
}
