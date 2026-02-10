import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUpdateUserVocabularyReview } from "@/hooks/useUserVocabulary";
import { HomeButton } from "@/components/HomeButton";
import { RatingButtons } from "@/components/review/RatingButtons";
import { AppShell } from "@/components/layout/AppShell";
import { Loader2, Trophy, LogIn, Eye, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Rating, calculateNextReview } from "@/lib/spacedRepetition";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface DueUserWord {
  id: string;
  word_arabic: string;
  word_english: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
  last_reviewed_at: string | null;
  word_audio_url: string | null;
  sentence_audio_url: string | null;
}

const MyWordsReview = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const updateReview = useUpdateUserVocabularyReview();
  const queryClient = useQueryClient();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playAudio = (url: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(console.error);
  };

  const { data: dueWords, isLoading, refetch } = useQuery({
    queryKey: ["user-vocabulary-due-words", user?.id],
    queryFn: async (): Promise<DueUserWord[]> => {
      if (!user) return [];
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("user_vocabulary")
        .select("id, word_arabic, word_english, ease_factor, interval_days, repetitions, next_review_at, last_reviewed_at, word_audio_url, sentence_audio_url")
        .eq("user_id", user.id)
        .lte("next_review_at", now)
        .order("next_review_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const handleRate = async (rating: Rating) => {
    if (!dueWords || !dueWords[currentIndex]) return;
    const word = dueWords[currentIndex];

    const result = calculateNextReview(
      rating,
      word.ease_factor,
      word.interval_days,
      word.repetitions
    );

    await updateReview.mutateAsync({
      wordId: word.id,
      easeFactor: result.easeFactor,
      intervalDays: result.intervalDays,
      repetitions: result.repetitions,
      nextReviewAt: result.nextReviewAt,
    });

    setSessionCount((prev) => prev + 1);
    setShowAnswer(false);

    if (currentIndex < dueWords.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      await refetch();
      setCurrentIndex(0);
    }
  };

  if (authLoading || isLoading) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading your reviews...</p>
          </div>
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
          <h1 className="text-xl font-bold text-foreground mb-3">Login Required</h1>
          <p className="text-muted-foreground mb-8">Sign in to review your words.</p>
          <Button onClick={() => navigate("/auth")}>
            <LogIn className="h-4 w-4 mr-2" /> Login
          </Button>
        </div>
      </AppShell>
    );
  }

  if (!dueWords || dueWords.length === 0) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-between mb-6">
          <HomeButton />
          {sessionCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border">
              <Trophy className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">{sessionCount}</span>
            </div>
          )}
        </div>
        <div className="text-center max-w-sm mx-auto py-12">
          <Trophy className="h-14 w-14 mx-auto mb-6 text-primary" />
          <h1 className="text-xl font-bold text-foreground mb-3">All Caught Up!</h1>
          <p className="text-muted-foreground mb-8">
            No words due for review right now. Come back later!
          </p>
          <Button onClick={() => navigate("/my-words")}>Back to My Words</Button>
        </div>
      </AppShell>
    );
  }

  const currentWord = dueWords[currentIndex];
  const progress = ((currentIndex + 1) / dueWords.length) * 100;

  return (
    <AppShell compact>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <HomeButton />
        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-lg bg-card border border-border">
            <span className="text-sm font-medium text-foreground">My Words</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border">
            <Trophy className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">{sessionCount}</span>
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className="mb-6">
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2">
          {currentIndex + 1} / {dueWords.length} due
        </p>
      </div>

      {/* Card */}
      <div className="py-4">
        <div className="max-w-sm mx-auto">
          <div className="rounded-2xl bg-card border border-border p-8 text-center">
            <p
              className="text-4xl font-bold text-foreground mb-6"
              style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
              dir="rtl"
            >
              {currentWord.word_arabic}
            </p>

            {/* Audio buttons */}
            <div className="flex items-center justify-center gap-3 mb-8">
              {currentWord.word_audio_url && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => playAudio(currentWord.word_audio_url!)}
                  className="gap-1.5"
                >
                  <Volume2 className="h-4 w-4" />
                  Word
                </Button>
              )}
              {currentWord.sentence_audio_url && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => playAudio(currentWord.sentence_audio_url!)}
                  className="gap-1.5"
                >
                  <Volume2 className="h-4 w-4" />
                  Sentence
                </Button>
              )}
            </div>

            {/* Optional reveal English */}
            {showAnswer && (
              <div className="animate-in fade-in duration-200 mb-4">
                <p className="text-xl text-muted-foreground">{currentWord.word_english}</p>
              </div>
            )}
            {!showAnswer && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAnswer(true)}
                className="gap-1.5 text-muted-foreground"
              >
                <Eye className="h-4 w-4" />
                Reveal English
              </Button>
            )}
          </div>
        </div>

        {/* Self-rating always visible */}
        <div className="mt-10">
          <RatingButtons
            onRate={handleRate}
            easeFactor={currentWord.ease_factor}
            intervalDays={currentWord.interval_days}
            repetitions={currentWord.repetitions}
            disabled={updateReview.isPending}
          />
        </div>
      </div>
    </AppShell>
  );
};

export default MyWordsReview;
