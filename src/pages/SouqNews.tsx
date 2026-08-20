import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/layout/AppShell";
import { PageCorner } from "@/components/shell/PageCorner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { ArticleQuiz } from "@/components/souq-news/ArticleQuiz";
import { SentenceReader } from "@/components/shared/SentenceReader";
import { MarkUnknownsProvider } from "@/contexts/MarkUnknownsContext";
import { MarkUnknownsToggle } from "@/components/shared/MarkUnknownsToggle";
import { SaveUnknownsBar } from "@/components/shared/SaveUnknownsBar";
import { markTaskCompletedToday } from "@/lib/todayCompletion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { dialectAccent } from "@/lib/dialectAccent";
import {
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Newspaper,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { usePageAiContext } from "@/contexts/AiAssistantContext";
import { EmptyState } from "@/components/shared/EmptyState";

interface SouqArticle {
  title_dialect: string;
  body_dialect: string;
  title_english: string;
  summary_english: string;
  source_url: string | null;
  published_at: string;
  sentences?: { arabic: string; transliteration?: string; english: string; literal?: string }[];
  vocabulary?: { word_arabic: string; word_english: string }[];
}


const SouqNews = () => {
  const { activeDialect } = useDialect();
  const { user } = useAuth();
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());

  const {
    data: articles,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["souq-news", activeDialect],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("souq-news", {
        body: { dialect: activeDialect },
      });
      if (error) throw error;
      if (data?.error) {
        if (data.error.includes("Rate limit")) toast.error(data.error);
        else if (data.error.includes("credits")) toast.error(data.error);
        else throw new Error(data.error);
        return [] as SouqArticle[];
      }
      return (data?.articles || []) as SouqArticle[];
    },
    staleTime: 1000 * 60 * 15,
    retry: 1,
    // The function now requires a signed-in caller (it drives paid search and
    // model calls), so don't fire a request that can only come back 401.
    enabled: !!user,
  });

  // The article the learner has actually opened, if any — the assistant should
  // be looking at the same one they are.
  const openedIndex = expandedCards.size === 1 ? [...expandedCards][0] : -1;
  const openedArticle = openedIndex >= 0 ? (articles ?? [])[openedIndex] : undefined;

  usePageAiContext(
    useMemo(() => {
      const list = articles ?? [];
      // An opened article publishes its whole text sentence by sentence, with
      // the URL it was rewritten from; the index publishes the headlines. The
      // page previously sent five headlines either way, so asking about the
      // story you were reading got you a tutor that had only seen its title.
      const document = openedArticle
        ? {
            label: `Full article: ${openedArticle.title_english}`,
            sourceUrl: openedArticle.source_url ?? undefined,
            lines: (openedArticle.sentences?.length
              ? openedArticle.sentences.map((s, i) => ({
                  index: i + 1,
                  arabic: s.arabic,
                  english: s.english,
                }))
              : [{ index: 1, arabic: openedArticle.body_dialect }]),
          }
        : {
            label: "Today's headlines",
            lines: list.map((a, i) => ({
              index: i + 1,
              arabic: a.title_dialect,
              english: a.title_english,
            })),
          };

      return {
        kind: "passage" as const,
        title: openedArticle ? openedArticle.title_english : "Souq News",
        summary: `Today's news rewritten in ${activeDialect} Arabic, line by line with reveals and a quiz.`,
        content: openedArticle
          ? `${openedArticle.title_dialect} — ${openedArticle.title_english}`
          : undefined,
        document,
        meta: {
          dialect: activeDialect,
          vocabulary: openedArticle?.vocabulary?.map((v) => ({
            arabic: v.word_arabic,
            english: v.word_english,
          })),
          notes: openedArticle?.summary_english
            ? [`English summary of this story: ${openedArticle.summary_english}`]
            : undefined,
        },
      };
    }, [articles, activeDialect, openedArticle]),
  );

  const toggleCard = (i: number) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      const opening = !next.has(i);
      if (opening) {
        next.add(i);
        markTaskCompletedToday("souq");
      } else {
        next.delete(i);
      }
      return next;
    });
  };

  // The dialect's own accent, from the one table (src/lib/dialectAccent.ts).
  // This page carried a fourth private copy of it in raw Tailwind teal/amber/
  // red — cold colours on a warm-sand palette, and unrelated to the accent
  // the same dialect gets everywhere else in the app.
  const accent = dialectAccent(activeDialect);

  return (
    <AppShell>
      <PageCorner />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Newspaper className="h-6 w-6" style={{ color: `hsl(${accent})` }} />
            أخبار السوق
            <InfoHint {...PAGE_HINTS["souq-news"]} size="md" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Today's news, told like a friend at the souq
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <MarkUnknownsToggle />
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {!user ? (
        <EmptyState
          title="Sign in for today's news"
          body="Souq News rewrites real headlines into your dialect — sign in and they're ready every morning."
        />
      ) : isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border p-5 space-y-3">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">Failed to load news</p>
          <Button onClick={() => refetch()}>Try Again</Button>
        </div>
      ) : articles && articles.length === 0 ? (
        <EmptyState
          title="No news today"
          body="Fresh articles arrive most mornings — check back later."
        />
      ) : (
        <div className="space-y-4">
          {articles?.map((article, i) => {
            const expanded = expandedCards.has(i);
            return (
              <div
                key={i}
                className="rounded-2xl border p-5 transition-all duration-200"
                style={{
                  backgroundColor: `hsl(${accent} / 0.07)`,
                  borderColor: `hsl(${accent} / 0.22)`,
                }}
              >
                {/* Arabic headline */}
                <h2
                  className="text-lg font-bold text-foreground leading-relaxed mb-3"
                  dir="rtl"
                  style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
                >
                  {article.title_dialect}
                </h2>

                <div className="mb-3">
                  <AskAISentence
                    arabic={article.title_dialect}
                    english={article.title_english}
                    variant="chip"
                  />
                </div>

                {/* Arabic body — line by line with reveal */}
                <div className="mb-4">
                  <SentenceReader
                    body={article.body_dialect}
                    sentences={article.sentences}
                    vocabulary={article.vocabulary}
                    source="souq-news"
                  />
                </div>

                {/* English toggle */}
                <button
                  onClick={() => toggleCard(i)}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
                >
                  {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {expanded ? "Hide English" : "Show English"}
                </button>

                {expanded && (
                  <div className="bg-card/60 rounded-xl p-3 mb-3 border border-border/50">
                    <p className="font-semibold text-sm text-foreground mb-1">{article.title_english}</p>
                    <p className="text-xs text-muted-foreground">{article.summary_english}</p>
                  </div>
                )}

                {/* Source link */}
                {article.source_url && (
                  <a
                    href={article.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Source
                  </a>
                )}

                {/* Comprehension quiz */}
                <div className="mt-3 pt-3 border-t border-border/30">
                  <ArticleQuiz article={article} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <SaveUnknownsBar source="souq-news" />
    </AppShell>
  );
};

const SouqNewsPage = () => (
  <MarkUnknownsProvider>
    <SouqNews />
  </MarkUnknownsProvider>
);

export default SouqNewsPage;
