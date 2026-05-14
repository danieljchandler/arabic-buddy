import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUpdateUserVocabularyReview } from "@/hooks/useUserVocabulary";
import { useDialect } from "@/contexts/DialectContext";
import { HomeButton } from "@/components/HomeButton";
import { RatingButtons } from "@/components/review/RatingButtons";
import { AppShell } from "@/components/layout/AppShell";
import { Loader2, Trophy, LogIn, Eye, Volume2, Music, RefreshCw, Sparkles, Play, Brain, Mic2, Quote } from "lucide-react";
import { GenerateImageDialog } from "@/components/mywords/GenerateImageDialog";
import { useUpdateUserVocabularyImage } from "@/hooks/useUserVocabulary";
import { PronunciationButton } from "@/components/review/PronunciationButton";
import { Button } from "@/components/ui/button";
import { Rating, calculateNextReview } from "@/lib/spacedRepetition";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAzureTTS } from "@/hooks/useAzureTTS";

type CardType = "recognition" | "production";

interface DueCard {
  id: string;
  word_arabic: string;
  word_english: string;
  // active SRS fields for the chosen direction
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  due_at: string;
  card_type: CardType;
  // production lock state (used when rating recognition)
  production_locked: boolean;
  word_audio_url: string | null;
  sentence_audio_url: string | null;
  image_url: string | null;
  jingle_audio_url: string | null;
  sentence_text: string | null;
  sentence_english: string | null;
}

interface RawRow {
  id: string;
  word_arabic: string;
  word_english: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
  last_reviewed_at: string | null;
  production_ease_factor: number;
  production_interval_days: number;
  production_repetitions: number;
  production_next_review_at: string | null;
  production_last_reviewed_at: string | null;
  word_audio_url: string | null;
  sentence_audio_url: string | null;
  image_url: string | null;
  jingle_audio_url: string | null;
  sentence_text: string | null;
  sentence_english: string | null;
}

const MyWordsReview = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { activeDialect } = useDialect();
  const updateReview = useUpdateUserVocabularyReview();
  const queryClient = useQueryClient();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [jingleLoading, setJingleLoading] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const updateImage = useUpdateUserVocabularyImage();

  const playAudio = (url: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(console.error);
  };

  const { data: dueWords, isLoading, refetch } = useQuery({
    queryKey: ["user-vocabulary-due-words", user?.id, activeDialect],
    queryFn: async (): Promise<DueCard[]> => {
      if (!user) return [];
      const now = new Date().toISOString();

      // Fetch all rows that are due in either direction. We do two queries
      // and merge so each direction can be tagged independently.
      const baseSelect =
        "id, word_arabic, word_english, ease_factor, interval_days, repetitions, next_review_at, last_reviewed_at, production_ease_factor, production_interval_days, production_repetitions, production_next_review_at, production_last_reviewed_at, word_audio_url, sentence_audio_url, image_url, jingle_audio_url, sentence_text, sentence_english";

      const { data: recogRows, error: recogErr } = await (supabase
        .from("user_vocabulary")
        .select(baseSelect)
        .eq("user_id", user.id)
        .lte("next_review_at", now)
        .order("next_review_at", { ascending: true }) as any)
        .eq("dialect", activeDialect);
      if (recogErr) throw recogErr;

      const { data: prodRows, error: prodErr } = await (supabase
        .from("user_vocabulary")
        .select(baseSelect)
        .eq("user_id", user.id)
        .not("production_next_review_at", "is", null)
        .lte("production_next_review_at", now)
        .order("production_next_review_at", { ascending: true }) as any)
        .eq("dialect", activeDialect);
      if (prodErr) throw prodErr;

      const cards: DueCard[] = [];
      for (const r of (recogRows || []) as RawRow[]) {
        cards.push({
          id: r.id,
          word_arabic: r.word_arabic,
          word_english: r.word_english,
          ease_factor: r.ease_factor,
          interval_days: r.interval_days,
          repetitions: r.repetitions,
          due_at: r.next_review_at,
          card_type: "recognition",
          production_locked: r.production_next_review_at === null,
          word_audio_url: r.word_audio_url,
          sentence_audio_url: r.sentence_audio_url,
          image_url: r.image_url,
          jingle_audio_url: r.jingle_audio_url,
          sentence_text: r.sentence_text,
          sentence_english: r.sentence_english,
        });
      }
      for (const r of (prodRows || []) as RawRow[]) {
        cards.push({
          id: r.id,
          word_arabic: r.word_arabic,
          word_english: r.word_english,
          ease_factor: r.production_ease_factor,
          interval_days: r.production_interval_days,
          repetitions: r.production_repetitions,
          due_at: r.production_next_review_at!,
          card_type: "production",
          production_locked: false,
          word_audio_url: r.word_audio_url,
          sentence_audio_url: r.sentence_audio_url,
          image_url: r.image_url,
          jingle_audio_url: r.jingle_audio_url,
          sentence_text: r.sentence_text,
          sentence_english: r.sentence_english,
        });
      }

      cards.sort((a, b) => a.due_at.localeCompare(b.due_at));
      return cards;
    },
    enabled: !!user,
  });

  const currentWord = dueWords && dueWords.length > 0
    ? dueWords[Math.min(currentIndex, dueWords.length - 1)]
    : null;
  const isProduction = currentWord?.card_type === "production";

  // TTS fallback when no recorded word_audio_url is available
  const { ttsUrl: wordTtsUrl, isLoading: wordTtsLoading } = useAzureTTS({
    text: currentWord?.word_arabic ?? "",
    skip: !currentWord || Boolean(currentWord.word_audio_url),
    dialect: activeDialect,
  });

  const effectiveWordAudio = currentWord?.word_audio_url || wordTtsUrl;

  // Reset reveal state on card change
  useEffect(() => {
    setShowAnswer(false);
    setShowContext(false);
  }, [currentWord?.id, currentWord?.card_type]);

  // Auto-play: only on recognition cards (audio reinforces what's shown).
  // Production cards never autoplay — hearing the word defeats the recall exercise.
  useEffect(() => {
    if (!effectiveWordAudio || !currentWord) return;
    if (currentWord.card_type === "recognition") {
      playAudio(effectiveWordAudio);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWord?.id, currentWord?.card_type, effectiveWordAudio]);

  const generateJingle = async (word: DueCard, regenerate = false) => {
    if (!user) return;
    if (word.jingle_audio_url && !regenerate) {
      playAudio(word.jingle_audio_url);
      return;
    }
    setJingleLoading(true);
    try {
      const response = await supabase.functions.invoke("generate-word-jingle", {
        body: {
          word_arabic: word.word_arabic,
          word_english: word.word_english,
          dialect: activeDialect,
        },
      });
      if (response.error) throw new Error(response.error.message || "Failed to generate jingle");
      const audioBlob = response.data instanceof Blob
        ? response.data
        : new Blob([response.data], { type: "audio/mpeg" });
      const fileName = `jingles/${user.id}/${word.id}-${Date.now()}.mp3`;
      const { error: uploadError } = await supabase.storage
        .from("flashcard-audio")
        .upload(fileName, audioBlob, { contentType: "audio/mpeg", upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("flashcard-audio").getPublicUrl(fileName);
      const jingleUrl = urlData.publicUrl;
      await supabase.from("user_vocabulary").update({ jingle_audio_url: jingleUrl } as any).eq("id", word.id);
      queryClient.invalidateQueries({ queryKey: ["user-vocabulary-due-words"] });
      playAudio(jingleUrl);
      toast.success("🎵 Jingle created!");
    } catch (err: any) {
      console.error("Jingle generation error:", err);
      if (err?.message?.includes("Rate limit") || err?.message?.includes("429")) {
        toast.error("Rate limited — try again in a moment");
      } else if (err?.message?.includes("402") || err?.message?.includes("Credits")) {
        toast.error("AI credits exhausted — please add funds");
      } else {
        toast.error("Failed to generate jingle");
      }
    } finally {
      setJingleLoading(false);
    }
  };

  const handleRate = async (rating: Rating) => {
    if (!dueWords || !dueWords[currentIndex]) return;
    const card = dueWords[currentIndex];
    const wordCount = dueWords.length;

    const result = calculateNextReview(
      rating,
      card.ease_factor,
      5.0,
      card.interval_days,
      card.repetitions,
    );

    await updateReview.mutateAsync({
      wordId: card.id,
      stability: result.stability,
      difficulty: result.difficulty,
      intervalDays: result.intervalDays,
      repetitions: result.repetitions,
      nextReviewAt: result.nextReviewAt,
      cardType: card.card_type,
      rating,
      productionLocked: card.production_locked,
    });

    setSessionCount((prev) => prev + 1);
    setShowAnswer(false);

    if (currentIndex < wordCount - 1) {
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
            No cards due for review right now. Come back later!
          </p>
          <Button onClick={() => navigate("/my-words")}>Back to My Words</Button>
        </div>
      </AppShell>
    );
  }

  const safeIndex = Math.min(currentIndex, dueWords.length - 1);
  if (safeIndex !== currentIndex) {
    setCurrentIndex(safeIndex);
  }

  if (!currentWord) return null;

  const progress = ((safeIndex + 1) / dueWords.length) * 100;

  return (
    <AppShell compact>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <HomeButton />
        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-lg bg-card border border-border flex items-center gap-1.5">
            {isProduction ? <Mic2 className="h-3.5 w-3.5 text-primary" /> : <Brain className="h-3.5 w-3.5 text-primary" />}
            <span className="text-sm font-medium text-foreground">
              {isProduction ? "Produce" : "Recognize"}
            </span>
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
            {/* Image if available */}
            {currentWord.image_url && (
              <div className="mb-4 rounded-lg overflow-hidden bg-muted aspect-[4/3] flex items-center justify-center">
                <img
                  src={currentWord.image_url}
                  alt=""
                  className="w-full h-full object-contain"
                />
              </div>
            )}
            {/* Generate image button */}
            <div className="mb-6 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setImageDialogOpen(true)}
                className="gap-1.5 text-muted-foreground"
              >
                <Sparkles className="h-4 w-4" />
                {currentWord.image_url ? "Regenerate Image" : "Generate Image"}
              </Button>
            </div>

            {/* Prompt area */}
            {isProduction ? (
              <>
                {!showAnswer ? (
                  <>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                      Say it in Arabic
                    </p>
                    <p className="text-2xl font-semibold text-foreground mb-6">
                      {currentWord.word_english}
                    </p>
                  </>
                ) : (
                  <p
                    className="text-4xl font-bold text-foreground mb-6 animate-in fade-in duration-200"
                    style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                    dir="rtl"
                  >
                    {currentWord.word_arabic}
                  </p>
                )}
              </>
            ) : (
              <p
                className="text-4xl font-bold text-foreground mb-6"
                style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                dir="rtl"
              >
                {currentWord.word_arabic}
              </p>
            )}

            {/* Audio buttons */}
            <div className="flex items-center justify-center gap-2 flex-wrap mb-8">
              <Button
                variant="default"
                size="sm"
                onClick={() => effectiveWordAudio && playAudio(effectiveWordAudio)}
                disabled={!effectiveWordAudio || wordTtsLoading}
                className="gap-1.5"
              >
                {wordTtsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {isProduction && !showAnswer ? "Hear it" : "Play"}
              </Button>
              {currentWord.sentence_audio_url && (showAnswer || !isProduction) && (
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

              <Button
                variant="outline"
                size="sm"
                onClick={() => generateJingle(currentWord)}
                disabled={jingleLoading}
                className="gap-1.5"
              >
                {jingleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music className="h-4 w-4" />}
                {jingleLoading ? "Creating..." : currentWord.jingle_audio_url ? "🎵 Jingle" : "🎵 Generate"}
              </Button>

              {currentWord.jingle_audio_url && !jingleLoading && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => generateJingle(currentWord, true)}
                  title="Regenerate jingle"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              )}
            </div>

            {/* Pronunciation practice — only meaningful once Arabic is visible */}
            {(showAnswer || !isProduction) && (
              <div className="mb-6">
                <PronunciationButton word={currentWord.word_arabic} />
              </div>
            )}

            {/* Reveal */}
            {isProduction ? (
              !showAnswer && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowAnswer(true);
                    if (effectiveWordAudio) playAudio(effectiveWordAudio);
                  }}
                  className="gap-1.5 text-muted-foreground"
                >
                  <Eye className="h-4 w-4" />
                  Reveal Arabic
                </Button>
              )
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>

        {/* Self-rating always visible */}
        <div className="mt-10">
          <RatingButtons
            onRate={handleRate}
            stability={currentWord.ease_factor}
            difficulty={5.0}
            intervalDays={currentWord.interval_days}
            repetitions={currentWord.repetitions}
            disabled={updateReview.isPending}
          />
        </div>
      </div>

      <GenerateImageDialog
        word={currentWord}
        open={imageDialogOpen}
        onOpenChange={setImageDialogOpen}
        onImageSaved={async (wordId, imageUrl) => {
          await updateImage.mutateAsync({ wordId, imageUrl });
        }}
      />
    </AppShell>
  );
};

export default MyWordsReview;
