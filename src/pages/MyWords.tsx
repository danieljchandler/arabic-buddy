import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUserVocabulary, useUserVocabularyDueCount, useDeleteUserVocabulary, type UserVocabularyWord } from "@/hooks/useUserVocabulary";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { Button } from "@/components/ui/button";
import { BookOpen, Trash2, ChevronLeft, ChevronRight, Loader2, Shuffle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { GenerateImageDialog } from "@/components/mywords/GenerateImageDialog";

const MyWords = () => {
  const navigate = useNavigate();
  const [mixAll, setMixAll] = useState(false);
  const { activeDialect } = useDialect();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { data: words, isLoading } = useUserVocabulary(mixAll);
  const { data: stats } = useUserVocabularyDueCount(mixAll);
  const deleteWord = useDeleteUserVocabulary();
  const [imageDialogWord, setImageDialogWord] = useState<UserVocabularyWord | null>(null);

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
      </div>

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

      {/* Empty state */}
      {(!words || words.length === 0) && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold mb-2">No words saved yet</h2>
          <p className="text-muted-foreground mb-6 max-w-sm">
            Transcribe Arabic audio and tap the + button on vocabulary words to save them here.
          </p>
          <Button variant="outline" onClick={() => navigate("/transcribe")}>
            Go to Transcribe
          </Button>
        </div>
      )}

      {/* Word list */}
      {words && words.length > 0 && (
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          {words.map((word, index) => (
            <div
              key={word.id}
              className={cn(
                "flex items-center justify-between p-4",
                "hover:bg-muted/50 transition-colors",
                index < words.length - 1 && "border-b border-border"
              )}
            >
              <div className="flex items-center gap-3">
                {/* Thumbnail */}
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
          ))}
        </div>
      )}

      {/* Image generation dialog */}
      <GenerateImageDialog
        word={imageDialogWord}
        open={!!imageDialogWord}
        onOpenChange={(open) => { if (!open) setImageDialogWord(null); }}
      />
    </AppShell>
  );
};

export default MyWords;
