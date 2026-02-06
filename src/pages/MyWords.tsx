import { useNavigate } from "react-router-dom";
import { useUserVocabulary, useUserVocabularyDueCount, useDeleteUserVocabulary } from "@/hooks/useUserVocabulary";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { BookOpen, Trash2, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";

const MyWords = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { data: words, isLoading } = useUserVocabulary();
  const { data: stats } = useUserVocabularyDueCount();
  const deleteWord = useDeleteUserVocabulary();

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
              <div className="flex items-center gap-4">
                <span
                  className="text-xl font-bold text-foreground"
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
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {word.word_english}
                </span>
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
    </AppShell>
  );
};

export default MyWords;
