import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PageCorner } from "@/components/shell/PageCorner";
import { LoadingPanel } from "@/components/loading/LoadingPanel";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import { useDialect } from "@/contexts/DialectContext";
import {
  engagementLabel,
  type SocialPost,
  useSocialPosts,
  useTrendingTopics,
} from "@/hooks/useSocialTrends";
import { setShareHandoff } from "@/lib/shareInbox";
import { BookOpen, ExternalLink, MessageSquare, Send, TrendingUp } from "lucide-react";

const DIALECTS = ["All", "Gulf", "Egyptian", "Yemeni"];
const PLATFORMS = ["All", "telegram", "reddit"];

const PLATFORM_LABEL: Record<string, string> = { telegram: "Telegram", reddit: "Reddit", x: "X" };

function platformIcon(platform: string) {
  return platform === "reddit" ? (
    <MessageSquare className="h-3 w-3" />
  ) : (
    <Send className="h-3 w-3" />
  );
}

function PostCard({ post, onStudy }: { post: SocialPost; onStudy: () => void }) {
  const popularity = engagementLabel(post.platform, post.engagement);
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className="text-xs gap-1">
            {platformIcon(post.platform)}
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
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="secondary" onClick={onStudy} className="gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            Study this
          </Button>
          {post.url && (
            <Button size="sm" variant="ghost" asChild className="gap-1.5">
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

const Trending = () => {
  const navigate = useNavigate();
  const { activeDialect } = useDialect();
  // Default to All: the screened feed is thin per-dialect, and a Gulf learner
  // landing on an empty page reads as broken when Egyptian posts exist.
  const [dialect, setDialect] = useState<string>("All");

  const [platform, setPlatform] = useState<string>("All");

  const { data: topicsByCountry, isLoading: topicsLoading } = useTrendingTopics(dialect);
  const { data: posts, isLoading: postsLoading } = useSocialPosts({ dialect, platform });

  // The Translate page consumes a text handoff on mount — the same route the
  // OS share sheet uses — so "study" is one tap with nothing to paste.
  const studyPost = (post: SocialPost) => {
    setShareHandoff({ kind: "text", text: post.arabic_text });
    navigate("/translate");
  };

  const countries = [...(topicsByCountry?.keys() ?? [])].sort();

  return (
    <AppShell>
      <PageCorner />

      <h1
        className="text-2xl font-bold text-foreground mb-2 inline-flex items-center gap-2"
        style={{ fontFamily: "'Montserrat', sans-serif" }}
      >
        Trending
        <InfoHint {...PAGE_HINTS["trending"]} size="md" />
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        What the Arab world is posting right now — screened so only real dialect gets through
      </p>

      <div className="flex gap-2 mb-6">
        <Select value={dialect} onValueChange={setDialect}>
          <SelectTrigger className="flex-1 min-w-0" aria-label="Dialect">
            <SelectValue placeholder="Dialect" />
          </SelectTrigger>
          <SelectContent>
            {DIALECTS.map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={platform} onValueChange={setPlatform}>
          <SelectTrigger className="flex-1 min-w-0" aria-label="Platform">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            {PLATFORMS.map((p) => (
              <SelectItem key={p} value={p}>{PLATFORM_LABEL[p] ?? p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-foreground mb-3 inline-flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4 text-primary" />
          Trending on X today
        </h2>
        {topicsLoading ? (
          <LoadingPanel variant="inline" className="py-8" />
        ) : countries.length > 0 ? (
          <div className="space-y-3">
            {countries.map((country) => (
              <div key={country}>
                <p className="text-xs text-muted-foreground mb-1.5">{country}</p>
                <div className="flex gap-1.5 flex-wrap">
                  {topicsByCountry?.get(country)?.slice(0, 10).map((t) =>
                    t.source_url ? (
                      // Post bodies live behind X's login wall, so the chip
                      // links out to the live search instead of embedding.
                      <a key={t.id} href={t.source_url} target="_blank" rel="noopener noreferrer">
                        <Badge variant="secondary" className="text-sm" dir="auto">
                          {t.topic}
                        </Badge>
                      </a>
                    ) : (
                      <Badge key={t.id} variant="secondary" className="text-sm" dir="auto">
                        {t.topic}
                      </Badge>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No trends captured yet"
            body="The harvester hasn't run for this dialect today. Check back soon."
          />
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">Popular posts</h2>
        {postsLoading ? (
          <LoadingPanel variant="inline" className="py-8" />
        ) : posts && posts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} onStudy={() => studyPost(post)} />
            ))}
          </div>
        ) : (
          <EmptyState
            className="py-12"
            title="Nothing has passed the screen yet"
            body="Posts appear here once the harvester finds genuine dialect writing — news-register Arabic is filtered out on purpose."
          />
        )}
      </section>
    </AppShell>
  );
};

export default Trending;
