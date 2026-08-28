import { useState, useRef, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Loader2, ArrowLeft, Play, Pause, Volume2, Plus, Check, Trash2, Eye } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { TranslationPair } from "@/components/shared/TranslationPair";
import { useDisplayPrefs } from "@/hooks/useDisplayPrefs";
import { useAuth } from "@/hooks/useAuth";
import { useAddUserVocabulary } from "@/hooks/useUserVocabulary";
import {
  useListenEpisode,
  useGenerateListenLineAudio,
  useIncrementPlayCount,
  useDeleteListenEpisode,
} from "@/hooks/useListen";
import { usePageAiContext } from "@/contexts/AiAssistantContext";
import { toast } from "sonner";
import { isCappedError } from "@/lib/invokeError";

const ListenEpisode = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: episode, isLoading } = useListenEpisode(id);
  const { prefs } = useDisplayPrefs();
  const showEnglish = prefs?.showEnglish ?? false;
  const lineAudio = useGenerateListenLineAudio();
  const incrementPlay = useIncrementPlayCount();
  const addVocab = useAddUserVocabulary();
  const deleteEp = useDeleteListenEpisode();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingLine, setPlayingLine] = useState<number | null>(null);
  const [isPlayingFull, setIsPlayingFull] = useState(false);
  const [addedVocab, setAddedVocab] = useState<Set<string>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Listen first: the Arabic starts blurred, revealed per line on tap, all at
  // once via the header button, or automatically when a full play finishes.
  // Reading along from the first second trains grapheme-mediated
  // comprehension — the ear only works when it has to carry a pass alone.
  const [revealedLines, setRevealedLines] = useState<Set<number>>(new Set());
  const [revealAll, setRevealAll] = useState(false);
  const isRevealed = (i: number) => revealAll || revealedLines.has(i);
  const revealLine = (i: number) =>
    setRevealedLines((prev) => {
      const next = new Set(prev);
      next.add(i);
      return next;
    });
  const incrementedRef = useRef(false);

  // Which line the *full-episode* playback is sounding right now. The full
  // file is stitched from the per-line clips and generate-listen-audio stores
  // each line's duration on the row, so the prefix sums map currentTime to a
  // line index — which is what lets Ask AI answer "what did I just hear?"
  // mid-play instead of only knowing per-line taps. Kept after a pause on
  // purpose: right after pausing is exactly when that question gets asked.
  const [fullPlayLine, setFullPlayLine] = useState<number | null>(null);
  const [fullPlaySeconds, setFullPlaySeconds] = useState<number | null>(null);

  const lineStartTimes = useMemo(() => {
    const durations = episode?.line_durations;
    if (!durations || durations.length === 0) return null;
    const starts: number[] = [];
    let t = 0;
    for (const d of durations) {
      starts.push(t);
      t += d || 0;
    }
    return starts;
  }, [episode?.line_durations]);

  // Everything the assistant is told about this episode — the script, the key
  // vocabulary, which line is playing. But only *revealed* lines carry their
  // text: the page blurs the Arabic as a listening-first exercise, and the
  // per-line Ask AI chip already waits for the reveal so it can't leak the
  // answer around the blur. The assistant quoting a hidden line would defeat
  // the same exercise, so it sees that the line exists and nothing more.
  usePageAiContext(
    useMemo(() => {
      if (!episode) return null;
      const revealed = (i: number) => revealAll || revealedLines.has(i);
      // A tapped line wins over the full-play position: tapping is the more
      // deliberate "this one" gesture.
      const focusIndex = playingLine ?? fullPlayLine;
      const playing = focusIndex !== null ? episode.script[focusIndex] : undefined;
      return {
        kind: "story" as const,
        title: episode.title,
        summary: [
          `Listening to a ${episode.dialect} dialect ${episode.format} episode, listen-first: each line's text stays hidden until the learner reveals it, and hidden lines are withheld below on purpose — if asked about one, encourage another listen instead of guessing.`,
          episode.summary ?? "",
        ]
          .filter(Boolean)
          .join(" "),
        content:
          playing && focusIndex !== null && revealed(focusIndex)
            ? `${playing.arabic}${playing.english ? ` — ${playing.english}` : ""}`
            : undefined,
        document: {
          label: "Episode script",
          sourceId: episode.id,
          lines: episode.script.map((line, i) =>
            revealed(i)
              ? {
                  index: i + 1,
                  arabic: `${line.speaker}: ${line.arabic}`,
                  english: line.english,
                }
              : {
                  index: i + 1,
                  arabic: `${line.speaker}: (not yet revealed)`,
                },
          ),
        },
        meta: {
          dialect: episode.dialect,
          vocabulary: episode.key_vocabulary.map((v) => ({
            arabic: v.arabic,
            english: v.english,
          })),
        },
        position: {
          index: focusIndex !== null ? focusIndex + 1 : undefined,
          total: episode.script.length,
          atSeconds: fullPlaySeconds ?? undefined,
          durationSeconds: episode.duration_seconds ?? undefined,
        },
      };
    }, [episode, revealAll, revealedLines, playingLine, fullPlayLine, fullPlaySeconds]),
  );

  useEffect(() => {
    if (episode && !incrementedRef.current) {
      incrementedRef.current = true;
      incrementPlay.mutate(episode.id);
    }
  }, [episode, incrementPlay]);

  if (isLoading) {
    return <AppShell><div className="flex justify-center pt-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div></AppShell>;
  }
  if (!episode) {
    return <AppShell><div className="text-center pt-20"><p className="text-muted-foreground">Episode not found.</p><Button variant="ghost" onClick={() => navigate("/listen")}>Back</Button></div></AppShell>;
  }

  const playLine = async (lineIndex: number) => {
    try {
      const url = await lineAudio.mutateAsync({ episodeId: episode.id, lineIndex });
      if (audioRef.current) audioRef.current.pause();
      const a = new Audio(url);
      audioRef.current = a;
      setPlayingLine(lineIndex);
      a.onended = () => setPlayingLine(null);
      a.onerror = () => { setPlayingLine(null); toast.error("Playback failed"); };
      await a.play();
    } catch (e: any) {
      setPlayingLine(null);
      if (!isCappedError(e)) toast.error(e?.message ?? "Could not play");
    }
  };

  const togglePlayFull = async () => {
    if (!episode.full_audio_url) return;
    if (isPlayingFull && audioRef.current) {
      audioRef.current.pause();
      setIsPlayingFull(false);
      return;
    }
    const a = new Audio(episode.full_audio_url);
    audioRef.current = a;
    // Map currentTime to the sounding line for the Ask AI context. Both
    // setters dedupe via state equality (the index changes per line, the
    // seconds are floored), so ~4Hz timeupdate costs ~1 re-render a second.
    a.ontimeupdate = () => {
      setFullPlaySeconds(Math.floor(a.currentTime));
      if (!lineStartTimes) return;
      let idx = 0;
      while (idx + 1 < lineStartTimes.length && a.currentTime >= lineStartTimes[idx + 1]) idx++;
      setFullPlayLine(idx);
    };
    a.onended = () => {
      setIsPlayingFull(false);
      setFullPlayLine(null);
      setFullPlaySeconds(null);
      // One full pass by ear has been earned — reading along is now review,
      // not a crutch.
      setRevealAll(true);
    };
    a.onerror = () => {
      setIsPlayingFull(false);
      setFullPlayLine(null);
      setFullPlaySeconds(null);
      toast.error("Playback failed");
    };
    setIsPlayingFull(true);
    await a.play();
  };

  const addOneVocab = async (v: { arabic: string; english: string }) => {
    if (addedVocab.has(v.arabic)) return;
    try {
      await addVocab.mutateAsync({
        word_arabic: v.arabic,
        word_english: v.english,
        source: "listen",
        dialect: episode.dialect,
      });
      setAddedVocab((s) => new Set(s).add(v.arabic));
    } catch (e: any) {
      if (String(e?.message).includes("موجودة")) {
        setAddedVocab((s) => new Set(s).add(v.arabic));
      } else {
        toast.error(e?.message ?? "Could not add");
      }
    }
  };

  const addAllVocab = async () => {
    for (const v of episode.key_vocabulary) await addOneVocab(v);
    toast.success("Words added to your deck");
  };

  const confirmDelete = async () => {
    setConfirmDeleteOpen(false);
    await deleteEp.mutateAsync(episode.id);
    navigate("/listen");
  };

  const isOwner = user?.id === episode.creator_id;

  return (
    <AppShell>
      <div className="space-y-5 pb-24">
        <Button variant="ghost" size="sm" onClick={() => navigate("/listen")} className="-ml-2">
          <ArrowLeft className="h-4 w-4 mr-1" />Back to library
        </Button>

        <header className="space-y-2">
          <div className="flex gap-1.5 flex-wrap">
            <Badge variant="secondary" className="capitalize">{episode.format}</Badge>
            <Badge variant="outline">{episode.dialect}</Badge>
            <Badge variant="outline" className="capitalize">{episode.length_bucket}</Badge>
          </div>
          {/* dir="auto" + normal leading: titles can be English/mixed, and
              leading-tight at text-2xl clips harakat on stacked Naskh. */}
          <h1 className="text-2xl font-bold leading-normal" dir="auto">{episode.title}</h1>
          {episode.summary && <p className="text-sm text-muted-foreground">{episode.summary}</p>}

          {episode.audio_mode === "full" && (
            <div className="pt-2">
              {episode.audio_status === "pending" && (
                <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 mr-2 animate-spin" />Recording voices…</div>
              )}
              {episode.audio_status === "failed" && (
                <p className="text-sm text-destructive">Audio failed — you can still play each line on tap.</p>
              )}
              {episode.full_audio_url && (
                <Button onClick={togglePlayFull} size="lg" className="w-full">
                  {isPlayingFull ? <><Pause className="h-4 w-4 mr-2" />Pause episode</> : <><Play className="h-4 w-4 mr-2" />Play full episode</>}
                </Button>
              )}
            </div>
          )}
        </header>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Listen first — tap a line to read it, or reveal everything.
            </p>
            {!revealAll && (
              <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setRevealAll(true)}>
                <Eye className="h-3.5 w-3.5 mr-1.5" />
                Show all text
              </Button>
            )}
          </div>
          {episode.script.map((line, i) => (
            <Card key={i} className="p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                  {line.speaker}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {/* Only once revealed — the assistant chip carries the line's
                      text, which would leak the answer around the blur. */}
                  {isRevealed(i) && (
                    <AskAISentence arabic={line.arabic} english={line.english} variant="chip" />
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => playLine(i)}
                    disabled={lineAudio.isPending && playingLine !== i}
                    aria-label="Play line"
                  >
                    {playingLine === i ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              {isRevealed(i) ? (
                <>
                  <TappableArabicText
                    text={line.arabic}
                    source="listen"
                    sentenceContext={{ arabic: line.arabic, english: line.english }}
                  />
                  {showEnglish && line.english && (
                    <TranslationPair
                      variant="compact"
                      literal={line.literal}
                      natural={line.english}
                    />
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => revealLine(i)}
                  className="relative block w-full rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Reveal line ${i + 1}`}
                >
                  {/* The blurred text keeps the card's real height so
                      revealing doesn't reflow the page. */}
                  <div aria-hidden className="pointer-events-none select-none blur-[7px] opacity-50">
                    <TappableArabicText
                      text={line.arabic}
                      source="listen"
                      sentenceContext={{ arabic: line.arabic, english: line.english }}
                    />
                  </div>
                  <span className="absolute inset-0 flex items-center justify-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <Eye className="h-3.5 w-3.5" />
                    Tap to read
                  </span>
                </button>
              )}
            </Card>
          ))}
        </section>

        {episode.key_vocabulary.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Key vocabulary</h2>
              <Button size="sm" variant="outline" onClick={addAllVocab}><Plus className="h-3.5 w-3.5 mr-1" />Add all to My Words</Button>
            </div>
            <div className="space-y-1.5">
              {episode.key_vocabulary.map((v) => {
                const added = addedVocab.has(v.arabic);
                return (
                  <Card key={v.arabic} className="p-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold" dir="rtl">{v.arabic}</p>
                      <p className="text-xs text-muted-foreground">{v.english}{v.note ? ` — ${v.note}` : ""}</p>
                    </div>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => addOneVocab(v)} disabled={added}>
                      {added ? <Check className="h-4 w-4 text-primary" /> : <Plus className="h-4 w-4" />}
                    </Button>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {isOwner && (
          <div className="pt-4">
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />Delete episode
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this episode?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the episode. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
};

export default ListenEpisode;
