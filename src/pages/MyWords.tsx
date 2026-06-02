import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUserVocabulary, useUserVocabularyDueCount, useDeleteUserVocabulary, type UserVocabularyWord } from "@/hooks/useUserVocabulary";
import { useUserPhrases, useUserPhrasesDueCount, useDeleteUserPhrase } from "@/hooks/useUserPhrases";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { Button } from "@/components/ui/button";
import { BookOpen, Trash2, ChevronLeft, ChevronRight, Loader2, Shuffle, Sparkles, Quote, MessageCircleQuestion, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { GenerateImageDialog } from "@/components/mywords/GenerateImageDialog";
import { SuggestFlashcardsDialog } from "@/components/mywords/SuggestFlashcardsDialog";
import { ImportFromAnkiDialog } from "@/components/mywords/ImportFromAnkiDialog";
import { Wand2 } from "lucide-react";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";

const MyWords = () => {
  const navigate = useNavigate();
  const [mixAll, setMixAll] = useState(false);
  const { activeDialect } = useDialect();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { data: words, isLoading } = useUserVocabulary(mixAll);
  const { data: stats } = useUserVocabularyDueCount(mixAll);
  const deleteWord = useDeleteUserVocabulary();
  const { data: phrases } = useUserPhrases(mixAll);
  const { data: phraseStats } = useUserPhrasesDueCount(mixAll);
  const deletePhrase = useDeleteUserPhrase();
  const [imageDialogWord, setImageDialogWord] = useState<UserVocabularyWord | null>(null);
  const [expandedContext, setExpandedContext] = useState<Set<string>>(new Set());
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [showAllPhrases, setShowAllPhrases] = useState(false);

  const toggleContext = (id: string) => {
    setExpandedContext((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDelete = async (wordId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteWord.mutateAsync(wordId);
      toast.success("تم حذف الكلمة");
    } catch (error) {
      toast.error("فشل حذف الكلمة");
    }
  };

  if (authLoading || isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Sign in to view your words</h2>
          <p className="text-muted-foreground mb-6">
            Save vocabulary from transcriptions and review them with spaced repetition.
          </p>
          <Button onClick={() => navigate("/auth")}>Sign In</Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/")}
          className="text-muted-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">My Words</h1>
          <InfoHint {...PAGE_HINTS["my-words"]} />
        </div>
        <span className="text-sm text-muted-foreground">
          ({words?.length || 0})
        </span>
        <Button
          variant={mixAll ? "default" : "outline"}
          size="sm"
          className="ml-auto gap-1.5"
          onClick={() => setMixAll(!mixAll)}
        >
          <Shuffle className="h-4 w-4" />
          {mixAll ? "All Dialects" : activeDialect}
        </Button>
        <InfoHint
          title="Mix all dialects"
          body="Toggle this to review words from every dialect at once. Leave it off to stay focused on your current dialect only."
        />
      </div>

      {/* AI suggest button */}
      <Button
        onClick={() => setSuggestOpen(true)}
        variant="outline"
        className="w-full mb-3 gap-2"
      >
        <Wand2 className="h-4 w-4" />
        Get AI flashcard suggestions
      </Button>

      {/* Review button */}
      {stats && stats.dueCount > 0 && (
        <Button
          onClick={() => navigate("/review/my-words")}
          className="w-full mb-6 gap-2"
          size="lg"
        >
          Review {stats.dueCount} due words
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}

      {/* My Phrases section */}
      <div className="mb-8 rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <MessageCircleQuestion className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-foreground">My Phrases</h2>
            <InfoHint {...PAGE_HINTS["my-phrases"]} />
            <span className="text-xs text-muted-foreground">
              ({phraseStats?.total ?? 0})
            </span>
          </div>
          {phraseStats && phraseStats.dueCount > 0 && (
            <Button
              size="sm"
              onClick={() => navigate("/review/my-phrases")}
              className="gap-1.5"
            >
              Review {phraseStats.dueCount}
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>

        {(!phrases || phrases.length === 0) ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Save phrases from{" "}
            <button
              className="text-primary underline underline-offset-2"
              onClick={() => navigate("/how-do-i-say")}
            >
              How do I say…?
            </button>{" "}
            to start practicing them here.
          </div>
        ) : (
          <>
            {(showAllPhrases ? phrases : phrases.slice(0, 4)).map((p, i, arr) => (
              <div
                key={p.id}
                className={cn(
                  "flex items-center justify-between gap-3 p-3",
                  i < arr.length - 1 && "border-b border-border"
                )}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="text-base font-semibold text-foreground truncate"
                    dir="rtl"
                    style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                  >
                    {p.phrase_arabic}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {p.phrase_english}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await deletePhrase.mutateAsync(p.id);
                      toast.success("Phrase removed");
                    } catch {
                      toast.error("Failed to remove phrase");
                    }
                  }}
                  disabled={deletePhrase.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {phrases.length > 4 && (
              <button
                className="w-full p-3 text-xs text-muted-foreground hover:text-foreground border-t border-border bg-muted/20"
                onClick={() => setShowAllPhrases((v) => !v)}
              >
                {showAllPhrases ? "Show less" : `Show all ${phrases.length}`}
              </button>
            )}
          </>
        )}
      </div>
      {(!words || words.length === 0) && (
        <div className="flex flex-col items-center justify-center py-16 text-center px-4">
          <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold mb-2">No words saved yet</h2>
          <p className="text-muted-foreground mb-6 max-w-sm">
            Start a lesson or watch a clip in Discover — tap any Arabic word to save it here, then review it with flashcards.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
            <Button className="flex-1 h-11" onClick={() => navigate("/learn")}>
              Start a lesson
            </Button>
            <Button variant="outline" className="flex-1 h-11" onClick={() => navigate("/discover")}>
              Browse Discover
            </Button>
          </div>
        </div>
      )}

      {/* Word list */}
      {words && words.length > 0 && (
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          {words.map((word, index) => {
            const hasContext = !!word.sentence_text;
            const isExpanded = expandedContext.has(word.id);
            return (
            <div
              key={word.id}
              className={cn(
                "p-4",
                "hover:bg-muted/50 transition-colors",
                index < words.length - 1 && "border-b border-border"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {word.image_url ? (
                    <img
                      src={word.image_url}
                      alt={word.word_english}
                      className="w-10 h-10 rounded-lg object-cover border border-border flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-muted/50 border border-dashed border-border flex items-center justify-center flex-shrink-0">
                      <Sparkles className="h-4 w-4 text-muted-foreground/50" />
                    </div>
                  )}
                  <div>
                    <span
                      className="text-lg font-bold text-foreground block"
                      style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                      dir="rtl"
                    >
                      {word.word_arabic}
                    </span>
                    {word.root && (
                      <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {word.root}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground hidden sm:inline">
                    {word.word_english}
                  </span>
                  {hasContext && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-8 w-8 hover:text-primary",
                        isExpanded ? "text-primary" : "text-muted-foreground"
                      )}
                      onClick={(e) => { e.stopPropagation(); toggleContext(word.id); }}
                      title="Show original sentence"
                    >
                      <Quote className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                    onClick={(e) => { e.stopPropagation(); setImageDialogWord(word); }}
                    title="Generate image"
                  >
                    <Sparkles className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={(e) => handleDelete(word.id, e)}
                    disabled={deleteWord.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {hasContext && isExpanded && (
                <div className="mt-3 ml-1 border-l-2 border-primary/30 pl-3 py-1 bg-muted/30 rounded-r">
                  <p className="text-xs text-muted-foreground mb-1">Original context</p>
                  <p
                    className="text-sm text-foreground/90 font-arabic leading-relaxed"
                    dir="rtl"
                    style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                  >
                    {word.sentence_text}
                  </p>
                  {word.sentence_english && (
                    <p className="text-xs text-muted-foreground mt-1 italic">
                      {word.sentence_english}
                    </p>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* Image generation dialog */}
      <GenerateImageDialog
        word={imageDialogWord}
        open={!!imageDialogWord}
        onOpenChange={(open) => { if (!open) setImageDialogWord(null); }}
      />

      <SuggestFlashcardsDialog open={suggestOpen} onOpenChange={setSuggestOpen} />
    </AppShell>
  );
};

export default MyWords;
