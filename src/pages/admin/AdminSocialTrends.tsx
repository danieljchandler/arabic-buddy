import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadingPanel } from "@/components/loading/LoadingPanel";
import { EmptyState } from "@/components/shared/EmptyState";
import { toast } from "sonner";
import {
  engagementLabel,
  type HarvestSummary,
  screenInfo,
  type SocialPost,
  useAdminSocialPosts,
  useRunSocialHarvest,
  useSetSocialPostStatus,
  useTrendingTopics,
} from "@/hooks/useSocialTrends";
import {
  Check,
  ExternalLink,
  Loader2,
  MessageSquare,
  Rss,
  Send,
  TrendingUp,
  X,
} from "lucide-react";

const DIALECTS = ["All", "Gulf", "Egyptian", "Yemeni"];
const PLATFORMS = ["All", "telegram", "reddit"];
const PLATFORM_LABEL: Record<string, string> = { telegram: "Telegram", reddit: "Reddit", x: "X" };

// Tab order mirrors the pipeline: what needs a human first.
const STATUS_TABS = [
  { value: "screened", label: "Needs review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "pending", label: "Unscreened" },
];

function harvestToast(summary: HarvestSummary) {
  const posts = (summary.telegramPosts ?? 0) + (summary.redditPosts ?? 0);
  const perDialect = Object.entries(summary.review ?? {})
    .map(([dialect, r]) => `${dialect} ${r.have}/${r.target}`)
    .join(" · ");
  toast.success("Harvest complete", {
    description:
      `${summary.topics ?? 0} topics, ${posts} posts collected, ` +
      `${summary.screenCalls ?? 0} screened. In review: ${perDialect || "none"}`,
  });
}

function PostCard({ post }: { post: SocialPost }) {
  const setStatus = useSetSocialPostStatus();
  const popularity = engagementLabel(post.platform, post.engagement);
  const screen = screenInfo(post);

  const judge = (status: "approved" | "rejected") =>
    setStatus.mutate(
      { id: post.id, status },
      { onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed") },
    );

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className="text-xs gap-1">
            {post.platform === "reddit" ? (
              <MessageSquare className="h-3 w-3" />
            ) : (
              <Send className="h-3 w-3" />
            )}
            {PLATFORM_LABEL[post.platform] ?? post.platform}
          </Badge>
          <Badge variant="outline" className="text-xs">{post.dialect}</Badge>
          {post.country && <Badge variant="outline" className="text-xs">{post.country}</Badge>}
          {popularity && (
            <span className="text-xs text-muted-foreground ml-auto">{popularity}</span>
          )}
        </div>

        <p dir="rtl" className="text-lg leading-relaxed text-foreground whitespace-pre-line">
          {post.arabic_text}
        </p>
        {post.translation && (
          <p className="text-sm text-muted-foreground">{post.translation}</p>
        )}

        {/* The screen's own case notes, so the reviewer judges the verdict
            rather than re-doing the analysis from scratch. */}
        {screen.register && (
          <p className="text-xs text-muted-foreground border-l-2 border-border pl-2">
            Screen: {screen.register}
            {typeof screen.confidence === "number" && ` (${Math.round(screen.confidence * 100)}%)`}
            {screen.reason && ` — ${screen.reason}`}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          {post.status !== "approved" && (
            <Button
              size="sm"
              onClick={() => judge("approved")}
              disabled={setStatus.isPending}
              className="gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Approve
            </Button>
          )}
          {post.status !== "rejected" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => judge("rejected")}
              disabled={setStatus.isPending}
              className="gap-1.5"
            >
              <X className="h-3.5 w-3.5" />
              Reject
            </Button>
          )}
          {post.url && (
            <Button size="sm" variant="ghost" asChild className="gap-1.5 ml-auto">
              <a href={post.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Original
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const AdminSocialTrends = () => {
  const [status, setStatus] = useState<string>("screened");
  const [dialect, setDialect] = useState<string>("All");
  const [platform, setPlatform] = useState<string>("All");

  const { data: posts, isLoading } = useAdminSocialPosts({ status, dialect, platform });
  const { data: topicsByCountry } = useTrendingTopics(dialect);
  const harvest = useRunSocialHarvest();

  const runHarvest = () =>
    harvest.mutate(undefined, {
      onSuccess: harvestToast,
      onError: (e) => toast.error(e instanceof Error ? e.message : "Harvest failed"),
    });

  const countries = [...(topicsByCountry?.keys() ?? [])].sort();

  return (
    <div className="container mx-auto max-w-5xl p-4">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Rss className="h-7 w-7 text-primary" /> Social Trends
        </h1>
        <Button onClick={runHarvest} disabled={harvest.isPending} className="gap-1.5">
          {harvest.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <TrendingUp className="h-4 w-4" />
          )}
          {harvest.isPending ? "Harvesting…" : "Run harvest"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Harvested X trends and Telegram/Reddit posts. The AI screen only fills the queue —
        nothing is published until you approve it here.
      </p>

      {countries.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold mb-2 inline-flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-primary" />
            Trending on X today
          </h2>
          <div className="space-y-2">
            {countries.map((country) => (
              <div key={country} className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground w-24 shrink-0">{country}</span>
                {topicsByCountry?.get(country)?.slice(0, 8).map((t) => (
                  <a key={t.id} href={t.source_url ?? undefined} target="_blank" rel="noopener noreferrer">
                    <Badge variant="secondary" dir="auto">{t.topic}</Badge>
                  </a>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        <Tabs value={status} onValueChange={setStatus}>
          <TabsList>
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select value={dialect} onValueChange={setDialect}>
          <SelectTrigger className="w-32" aria-label="Dialect">
            <SelectValue placeholder="Dialect" />
          </SelectTrigger>
          <SelectContent>
            {DIALECTS.map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={platform} onValueChange={setPlatform}>
          <SelectTrigger className="w-32" aria-label="Platform">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            {PLATFORMS.map((p) => (
              <SelectItem key={p} value={p}>{PLATFORM_LABEL[p] ?? p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <LoadingPanel variant="inline" className="py-16" />
      ) : posts && posts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      ) : (
        <EmptyState
          className="py-12"
          title={status === "screened" ? "Review queue is empty" : "Nothing here"}
          body={
            status === "screened"
              ? "Run a harvest to fetch fresh posts — passes land here for your verdict."
              : "Switch tabs or filters, or run a harvest."
          }
        />
      )}
    </div>
  );
};

export default AdminSocialTrends;
