import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Loader2, Volume2, Trophy, RefreshCw, BookmarkPlus } from "lucide-react";
import { toast } from "sonner";
import { SceneCanvas } from "@/components/picture-scenes/SceneCanvas";
import {
  useScene,
  useRecordSceneCompletion,
  type PictureSceneHotspot,
} from "@/hooks/usePictureScenes";
import { useBulkAddUserVocabulary } from "@/hooks/useUserVocabulary";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type Phase = "explore" | "quiz" | "done";

const PictureScenePlayer = () => {
  const { sceneId } = useParams<{ sceneId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: scene, isLoading } = useScene(sceneId);
  const recordCompletion = useRecordSceneCompletion();
  const bulkAdd = useBulkAddUserVocabulary();

  const [phase, setPhase] = useState<Phase>("explore");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tappedIds, setTappedIds] = useState<Set<string>>(new Set());
  const [quizQueue, setQuizQueue] = useState<PictureSceneHotspot[]>([]);
  const [quizIdx, setQuizIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [wrongIds, setWrongIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [autoAdded, setAutoAdded] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const placedHotspots = useMemo(
    () => (scene?.hotspots ?? []).filter((h) => h.x_pct != null && h.y_pct != null),
    [scene?.hotspots],
  );

  // Auto-add words to user's vocabulary on first load
  useEffect(() => {
    if (autoAdded || !user || !scene || placedHotspots.length === 0) return;
    setAutoAdded(true);
    bulkAdd.mutate(
      {
        words: placedHotspots.map((h) => ({
          word_arabic: h.word_arabic,
          word_english: h.word_english,
          root: h.root,
          word_audio_url: h.word_audio_url ?? undefined,
          source: "picture_scene",
        })),
        dialect: scene.dialect,
        source: "picture_scene",
      },
      {
        onSuccess: ({ added, skipped }) => {
          if (added > 0) {
            toast.success(`${added} word${added === 1 ? "" : "s"} added to flashcards`, {
              description: skipped > 0 ? `${skipped} already in your collection` : undefined,
            });
          }
        },
      },
    );
  }, [autoAdded, user, scene, placedHotspots, bulkAdd]);

  const playAudio = (url: string | null) => {
    if (!url) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const a = new Audio(url);
    audioRef.current = a;
    a.play().catch(() => {});
  };

  const handleExploreTap = (hs: PictureSceneHotspot) => {
    setSelectedId(hs.id);
    setTappedIds((s) => new Set(s).add(hs.id));
    playAudio(hs.word_audio_url);
  };

  const startQuiz = () => {
    const shuffled = [...placedHotspots].sort(() => Math.random() - 0.5);
    setQuizQueue(shuffled);
    setQuizIdx(0);
    setScore(0);
    setWrongIds(new Set());
    setSelectedId(null);
    setFeedback(null);
    setPhase("quiz");
  };

  const advanceQuiz = (delay = 700) => {
    setTimeout(() => {
      setFeedback(null);
      setSelectedId(null);
      if (quizIdx + 1 >= quizQueue.length) {
        setPhase("done");
        if (sceneId) {
          recordCompletion.mutate({
            sceneId,
            score: score + (feedback === "correct" ? 1 : 0),
            total: quizQueue.length,
          });
        }
      } else {
        setQuizIdx((i) => i + 1);
      }
    }, delay);
  };

  const handleQuizTap = (hs: PictureSceneHotspot) => {
    if (feedback) return;
    const target = quizQueue[quizIdx];
    if (hs.id === target.id) {
      setScore((s) => s + 1);
      setFeedback("correct");
      setSelectedId(hs.id);
      playAudio(hs.word_audio_url);
      advanceQuiz(800);
    } else {
      setFeedback("wrong");
      setWrongIds((s) => new Set(s).add(target.id));
      // brief pause, do NOT advance — let them try again
      setTimeout(() => setFeedback(null), 600);
    }
  };

  const handleQuizMiss = () => {
    if (feedback) return;
    setFeedback("wrong");
    setTimeout(() => setFeedback(null), 400);
  };

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!scene) {
    return (
      <AppShell>
        <p className="text-center py-12 text-muted-foreground">Scene not found.</p>
      </AppShell>
    );
  }

  const target = quizQueue[quizIdx];

  return (
    <AppShell>
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/picture-scenes")}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Scenes
          </Button>
          <Badge variant="outline">{scene.theme}</Badge>
        </div>

        <div className="text-center mb-4">
          <h1 className="text-xl font-bold" dir="rtl">{scene.title_arabic}</h1>
          <p className="text-sm text-muted-foreground">{scene.title}</p>
        </div>

        {phase === "explore" && (
          <>
            <SceneCanvas
              imageUrl={scene.image_url}
              hotspots={placedHotspots}
              mode="explore"
              selectedId={selectedId}
              onHotspotTap={handleExploreTap}
            />
            <div className="mt-3 text-center text-sm text-muted-foreground">
              Tap an object to hear it. ({tappedIds.size} / {placedHotspots.length} explored)
            </div>

            {selectedId && (
              <div className="mt-3 p-4 rounded-xl border bg-card">
                {(() => {
                  const hs = placedHotspots.find((h) => h.id === selectedId);
                  if (!hs) return null;
                  return (
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xl font-semibold" dir="rtl">{hs.word_arabic}</p>
                        <p className="text-sm text-muted-foreground">{hs.word_english}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => playAudio(hs.word_audio_url)}
                        disabled={!hs.word_audio_url}
                      >
                        <Volume2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })()}
              </div>
            )}

            <Button
              className="w-full mt-4"
              size="lg"
              onClick={startQuiz}
              disabled={placedHotspots.length === 0}
            >
              {tappedIds.size < placedHotspots.length
                ? `Start quiz (${tappedIds.size}/${placedHotspots.length} explored)`
                : "Start quiz"}
            </Button>
          </>
        )}

        {phase === "quiz" && target && (
          <>
            <Progress
              value={((quizIdx) / quizQueue.length) * 100}
              className="mb-3 h-2"
            />
            <div
              className={cn(
                "mb-3 p-4 rounded-xl border-2 text-center transition-colors",
                feedback === "correct" && "border-green-500 bg-green-500/10",
                feedback === "wrong" && "border-red-500 bg-red-500/10",
                !feedback && "border-primary/30 bg-primary/5",
              )}
            >
              <p className="text-xs text-muted-foreground mb-1">
                Tap on the picture: {quizIdx + 1} / {quizQueue.length}
              </p>
              <div className="flex items-center justify-center gap-2">
                <p className="text-2xl font-bold" dir="rtl">{target.word_arabic}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => playAudio(target.word_audio_url)}
                  disabled={!target.word_audio_url}
                >
                  <Volume2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <SceneCanvas
              imageUrl={scene.image_url}
              hotspots={placedHotspots}
              mode="quiz"
              targetId={target.id}
              selectedId={feedback === "correct" ? selectedId : null}
              onHotspotTap={handleQuizTap}
              onMiss={handleQuizMiss}
              showHotspots={false}
            />
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Score: {score} / {quizQueue.length}
            </p>
          </>
        )}

        {phase === "done" && (
          <div className="text-center py-8 space-y-4">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-amber-500/10 mb-2">
              <Trophy className="h-10 w-10 text-amber-500" />
            </div>
            <h2 className="text-2xl font-bold">
              {score} / {quizQueue.length}
            </h2>
            <p className="text-muted-foreground">
              {score === quizQueue.length
                ? "Perfect! Every word nailed."
                : score >= quizQueue.length / 2
                ? "Nice work — keep practicing!"
                : "Keep at it — try again to lock it in."}
            </p>
            {wrongIds.size > 0 && (
              <div className="text-left p-4 rounded-xl border bg-card">
                <p className="text-xs text-muted-foreground mb-2">Review these:</p>
                <div className="flex flex-wrap gap-2">
                  {placedHotspots
                    .filter((h) => wrongIds.has(h.id))
                    .map((h) => (
                      <Badge key={h.id} variant="secondary" className="text-xs">
                        <span dir="rtl">{h.word_arabic}</span>
                        <span className="mx-1 opacity-50">·</span>
                        {h.word_english}
                      </Badge>
                    ))}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Button onClick={startQuiz} variant="outline" className="w-full">
                <RefreshCw className="h-4 w-4 mr-2" />
                Try again
              </Button>
              <Button onClick={() => navigate("/my-words")} variant="ghost" className="w-full">
                <BookmarkPlus className="h-4 w-4 mr-2" />
                Review in flashcards
              </Button>
              <Button onClick={() => navigate("/picture-scenes")} className="w-full">
                Back to scenes
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default PictureScenePlayer;
