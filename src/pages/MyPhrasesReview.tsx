import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { useDueUserPhrases, useUpdateUserPhraseReview, useDeleteUserPhrase } from "@/hooks/useUserPhrases";
import { HomeButton } from "@/components/HomeButton";
import { RatingButtons } from "@/components/review/RatingButtons";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Rating, calculateNextReview } from "@/lib/spacedRepetition";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { Loader2, Trophy, LogIn, Eye, Volume2, Trash2, MessageCircleQuestion } from "lucide-react";
import { toast } from "sonner";

const MyPhrasesReview = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { activeDialect } = useDialect();
  const { data: duePhrases, isLoading, refetch } = useDueUserPhrases();
  const updateReview = useUpdateUserPhraseReview();
  const deletePhrase = useDeleteUserPhrase();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const safeIndex =
    duePhrases && duePhrases.length > 0
      ? Math.min(currentIndex, duePhrases.length - 1)
      : 0;
  const current = duePhrases?.[safeIndex] ?? null;

  const { ttsUrl, isLoading: ttsLoading } = useAzureTTS({
    text: current?.phrase_arabic ?? "",
    skip: !current,
    dialect: activeDialect,
  });

  const playAudio = (url: string) => {
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(() => {});
  };

  // Reset reveal between cards
  useEffect(() => {
    setShowAnswer(false);
  }, [current?.id]);

  const handleRate = async (rating: Rating) => {
    if (!current || !duePhrases) return;
    const count = duePhrases.length;

    const result = calculateNextReview(
      rating,
      Number(current.ease_factor) || 0,
      Number(current.difficulty) || 5,
      current.interval_days,
      current.repetitions,
    );

    await updateReview.mutateAsync({
      phraseId: current.id,
      stability: result.stability,
      difficulty: result.difficulty,
      intervalDays: result.intervalDays,
      repetitions: result.repetitions,
      nextReviewAt: result.nextReviewAt,
    });

    setSessionCount((p) => p + 1);
    setShowAnswer(false);

    if (currentIndex < count - 1) {
      setCurrentIndex((p) => p + 1);
    } else {
      await refetch();
      setCurrentIndex(0);
    }
  };

  const handleDelete = async () => {
    if (!current) return;
    if (!confirm("Remove this phrase from your saved list?")) return;
    try {
      await deletePhrase.mutateAsync(current.id);
      toast.success("Phrase removed");
      await refetch();
      setCurrentIndex(0);
    } catch {
      toast.error("Failed to remove phrase");
    }
  };

  if (authLoading || isLoading) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppShell compact>
        <div className="mb-6"><HomeButton /></div>
        <div className="text-center max-w-sm mx-auto py-12">
          <LogIn className="h-7 w-7 text-muted-foreground mx-auto mb-6" />
          <h1 className="text-xl font-bold mb-3">Login Required</h1>
          <p className="text-muted-foreground mb-8">Sign in to review your saved phrases.</p>
          <Button onClick={() => navigate("/auth")}>
            <LogIn className="h-4 w-4 mr-2" /> Login
          </Button>
        </div>
      </AppShell>
    );
  }

  if (!duePhrases || duePhrases.length === 0) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-between mb-6">
          <HomeButton />
          {sessionCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border">
              <Trophy className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{sessionCount}</span>
            </div>
          )}
        </div>
        <div className="text-center max-w-sm mx-auto py-12">
          <Trophy className="h-14 w-14 mx-auto mb-6 text-primary" />
          <h1 className="text-xl font-bold mb-3">All Caught Up!</h1>
          <p className="text-muted-foreground mb-8">
            No phrases due for review right now.
          </p>
          <Button onClick={() => navigate("/my-words")}>Back to My Words</Button>
        </div>
      </AppShell>
    );
  }

  if (!current) return null;
  const progress = ((safeIndex + 1) / duePhrases.length) * 100;
  const effectiveAudio = ttsUrl;

  return (
    <AppShell compact>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <HomeButton />
        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg bg-card border border-border flex items-center gap-1.5">
            <MessageCircleQuestion className="h-3.5 w-3.5 text-primary" />
            <span className="text-sm font-medium">Phrase</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border">
            <Trophy className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{sessionCount}</span>
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className="mb-6">
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2">
          {safeIndex + 1} / {duePhrases.length} due
        </p>
      </div>

      {/* Card */}
      <div className="py-4">
        <div className="max-w-sm mx-auto">
          <div className="rounded-2xl bg-card border border-border p-6 text-center space-y-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Say this in {activeDialect} Arabic:
            </p>
            <p className="text-xl font-semibold text-foreground leading-relaxed">
              {current.phrase_english}
            </p>

            {showAnswer ? (
              <div className="animate-in fade-in duration-200 space-y-3 pt-2">
                <p
                  className="text-3xl font-bold text-foreground leading-snug"
                  style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                  dir="rtl"
                >
                  {current.phrase_arabic}
                </p>
                {current.transliteration && (
                  <p className="text-sm italic text-primary/80">{current.transliteration}</p>
                )}
                {current.notes && (
                  <p className="text-xs text-muted-foreground italic">{current.notes}</p>
                )}
                <div className="flex justify-center pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => effectiveAudio && playAudio(effectiveAudio)}
                    disabled={!effectiveAudio || ttsLoading}
                    className="gap-1.5"
                  >
                    {ttsLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Volume2 className="h-4 w-4" />
                    )}
                    Play audio
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAnswer(true)}
                className="gap-1.5 text-muted-foreground"
              >
                <Eye className="h-4 w-4" />
                Reveal Arabic
              </Button>
            )}
          </div>

          <div className="flex justify-end mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              className="text-muted-foreground hover:text-destructive gap-1.5 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove from list
            </Button>
          </div>
        </div>

        {/* Self rating */}
        <div className="mt-8">
          <RatingButtons
            onRate={handleRate}
            stability={Number(current.ease_factor) || 0}
            difficulty={Number(current.difficulty) || 5}
            intervalDays={current.interval_days}
            repetitions={current.repetitions}
            disabled={updateReview.isPending}
          />
        </div>
      </div>
    </AppShell>
  );
};

export default MyPhrasesReview;
