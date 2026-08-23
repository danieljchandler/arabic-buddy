import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDialect } from '@/contexts/DialectContext';
import { useAddUserVocabulary } from '@/hooks/useUserVocabulary';
import {
  groupClipsByCategory,
  type ClipConcept,
  type ConceptWithClips,
  type PublishedClip,
} from '@/lib/clipLessons';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, RotateCcw, Eye, EyeOff, BookmarkPlus, Check, Clapperboard, ChevronRight } from 'lucide-react';

// Word Clips: the beginner curriculum's clip player. Every word is taught by
// a 5-10 second authentic clip mined and verified by the clip pipeline
// (docs/clip-pipeline.md) — a real speaker in a real scene, played through the
// official YouTube iframe at the clip's start/end window. Watch → replay →
// reveal the English → save the word into the SRS. Content comes from
// published_clips, keyed to the learner's active dialect.

const WordClips = () => {
  const { activeDialect } = useDialect();
  const { toast } = useToast();
  const addWord = useAddUserVocabulary();
  const [openConceptId, setOpenConceptId] = useState<string | null>(null);
  const [clipIndex, setClipIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  // Bumping the nonce remounts the iframe, which is how a clip replays.
  const [replayNonce, setReplayNonce] = useState(0);
  const [savedTerms, setSavedTerms] = useState<Set<string>>(new Set());

  const { data: concepts } = useQuery({
    queryKey: ['vocab-concepts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vocab_concepts')
        .select('id, key, english_gloss, category, sort_order')
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as ClipConcept[];
    },
  });

  const { data: clips, isLoading } = useQuery({
    queryKey: ['published-clips', activeDialect],
    queryFn: async () => {
      // `published_clips` is not in the generated Supabase types yet (types
      // regeneration needs platform access), so the table name needs a cast
      // like the other drifted tables in the repo.
      const { data, error } = await supabase
        .from('published_clips' as any)
        .select('id, concept_id, dialect, yt_video_id, start_ms, end_ms, term, term_gloss, arabic, translation, transliteration, channel_name')
        .eq('dialect', activeDialect)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown) as PublishedClip[];
    },
  });

  const categories = useMemo(
    () => groupClipsByCategory(concepts ?? [], clips ?? []),
    [concepts, clips],
  );

  const openClip = (entry: ConceptWithClips) => {
    setOpenConceptId(entry.concept.id);
    setClipIndex(0);
    setRevealed(false);
    setReplayNonce((n) => n + 1);
  };

  const saveClipWord = (clip: PublishedClip) => {
    addWord.mutate(
      {
        word_arabic: clip.term,
        word_english: clip.term_gloss ?? clip.translation,
        transliteration: clip.transliteration ?? undefined,
        sentence_text: clip.arabic,
        sentence_english: clip.translation,
        source: 'clip',
        dialect: clip.dialect,
      },
      {
        onSuccess: () => {
          setSavedTerms((prev) => new Set(prev).add(clip.term));
          toast({ title: 'Saved for review', description: clip.term });
        },
        onError: (e: Error) => {
          // Already-saved is success from the learner's point of view.
          if (e.message.includes('موجودة')) {
            setSavedTerms((prev) => new Set(prev).add(clip.term));
          } else {
            toast({ title: 'Could not save', description: e.message, variant: 'destructive' });
          }
        },
      },
    );
  };

  return (
    <AppShell compact>
      <div className="space-y-5 pb-8">
        <header className="pt-3">
          <h1 className="text-[28px] font-bold leading-tight flex items-center gap-2">
            <Clapperboard className="h-6 w-6 text-primary" /> Word Clips
          </h1>
          <p className="text-sm text-muted-foreground">
            Learn your first {activeDialect} words from real 5-second moments — no flashcards.
          </p>
        </header>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : categories.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              No {activeDialect} clips published yet — they land here as the clip pipeline
              approves them. Check back soon.
            </CardContent>
          </Card>
        ) : (
          categories.map((category) => (
            <section key={category.category}>
              <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase mb-2">
                {category.label}
              </h2>
              <div className="space-y-2.5">
                {category.concepts.map((entry) => {
                  const isOpen = openConceptId === entry.concept.id;
                  const clip = entry.clips[Math.min(clipIndex, entry.clips.length - 1)];
                  return (
                    <Card key={entry.concept.id}>
                      <CardContent className="pt-4 pb-4">
                        <button
                          type="button"
                          className="w-full flex items-center justify-between gap-3 text-left"
                          onClick={() => (isOpen ? setOpenConceptId(null) : openClip(entry))}
                        >
                          <span className="flex items-center gap-3 min-w-0">
                            <span dir="rtl" lang="ar" className="font-arabic text-xl font-semibold">
                              {entry.clips[0].term}
                            </span>
                            <span className="text-muted-foreground text-sm truncate">
                              {entry.concept.english_gloss}
                            </span>
                          </span>
                          <span className="flex items-center gap-2 shrink-0">
                            {entry.clips.length > 1 && (
                              <Badge variant="secondary">{entry.clips.length} clips</Badge>
                            )}
                            {savedTerms.has(entry.clips[0].term) && <Check className="h-4 w-4 text-primary" />}
                            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                          </span>
                        </button>

                        {isOpen && clip && (
                          <div className="mt-4 space-y-3">
                            <div className="aspect-video overflow-hidden rounded-xl border bg-black">
                              {/* Official iframe embed with start/end — the ToS-compliant clip surface. */}
                              <iframe
                                key={`${clip.id}-${replayNonce}`}
                                className="w-full h-full"
                                src={`https://www.youtube.com/embed/${clip.yt_video_id}?start=${Math.floor(clip.start_ms / 1000)}&end=${Math.ceil(clip.end_ms / 1000)}&autoplay=1&rel=0`}
                                title={`Clip: ${clip.term}`}
                                allow="autoplay; encrypted-media"
                                allowFullScreen
                              />
                            </div>

                            <p dir="rtl" lang="ar" className="font-arabic text-2xl leading-relaxed text-center">
                              {clip.arabic}
                            </p>
                            {revealed && (
                              <div className="text-center space-y-0.5">
                                <p className="text-base">{clip.translation}</p>
                                {clip.transliteration && (
                                  <p className="text-sm text-muted-foreground italic">{clip.transliteration}</p>
                                )}
                              </div>
                            )}

                            <div className="flex flex-wrap justify-center gap-2">
                              <Button size="sm" variant="outline" onClick={() => setReplayNonce((n) => n + 1)}>
                                <RotateCcw className="h-4 w-4" /> Replay
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setRevealed((r) => !r)}>
                                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                {revealed ? 'Hide English' : 'Show English'}
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => saveClipWord(clip)}
                                disabled={addWord.isPending || savedTerms.has(clip.term)}
                              >
                                {savedTerms.has(clip.term)
                                  ? <><Check className="h-4 w-4" /> Saved</>
                                  : <><BookmarkPlus className="h-4 w-4" /> Save word</>}
                              </Button>
                              {entry.clips.length > 1 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setClipIndex((i) => (i + 1) % entry.clips.length);
                                    setRevealed(false);
                                    setReplayNonce((n) => n + 1);
                                  }}
                                >
                                  Another clip
                                </Button>
                              )}
                            </div>
                            {clip.channel_name && (
                              <p className="text-xs text-muted-foreground text-center">
                                From {clip.channel_name} on YouTube
                              </p>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </AppShell>
  );
};

export default WordClips;
