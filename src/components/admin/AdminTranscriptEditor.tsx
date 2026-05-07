import { useMemo, useCallback, useRef } from "react";
import type { TranscriptLine, WordToken, Segment, Word } from "@/types/transcript";
import TranscriptEditor from "@/components/TranscriptEditor";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface AdminTranscriptEditorProps {
  lines: TranscriptLine[];
  onChange: (lines: TranscriptLine[]) => void;
  audioUrl?: string;
}

/**
 * Adapter that bridges TranscriptLine[] (admin data model, ms-based)
 * with TranscriptEditor's Segment[] (seconds-based).
 *
 * Token glosses are preserved via a ref map so round-tripping doesn't lose data.
 */
export function AdminTranscriptEditor({ lines, onChange, audioUrl }: AdminTranscriptEditorProps) {
  // Store glosses keyed by "segmentId:tokenIndex:surface" so they survive round-trips
  // Using index prevents collisions when the same word appears twice in one line
  const glossMapRef = useRef<Map<string, WordToken>>(new Map());

  // Populate gloss map from incoming lines
  useMemo(() => {
    const map = glossMapRef.current;
    for (const line of lines) {
      for (let i = 0; i < (line.tokens ?? []).length; i++) {
        const token = line.tokens[i];
        map.set(`${line.id}:${i}:${token.surface}`, token);
      }
    }
  }, [lines]);

  const initialSegments: Segment[] = useMemo(
    () =>
      lines.map((line) => {
        const startSec = (line.startMs ?? 0) / 1000;
        const endSec = (line.endMs ?? 0) / 1000;
        const tokens = line.tokens ?? [];
        const n = Math.max(tokens.length, 1);
        const dur = Math.max(endSec - startSec, 0);
        const step = dur / n;
        return {
          id: line.id,
          video_id: "",
          start: startSec,
          end: endSec,
          text: line.arabic,
          translation: line.translation,
          confidence: 1,
          // Distribute word timings evenly across the line so AI re-segmentation
          // (which rebuilds segment.start/end from word timings) preserves real
          // timestamps instead of collapsing to 0.
          words: tokens.map<Word>((t, i) => ({
            word: t.surface,
            start: startSec + step * i,
            end: startSec + step * (i + 1),
            confidence: 1,
          })),
        };
      }),
    [lines],
  );

  const handleSave = useCallback(
    (segments: Segment[]) => {
      const updated: TranscriptLine[] = segments.map((seg) => ({
        id: seg.id,
        arabic: seg.text,
        translation: seg.translation,
        startMs: Math.round(seg.start * 1000),
        endMs: Math.round(seg.end * 1000),
        tokens: seg.words.map<WordToken>((w, i) => {
          const cached = glossMapRef.current.get(`${seg.id}:${i}:${w.word}`);
          return {
            id: cached?.id ?? crypto.randomUUID(),
            surface: w.word,
            standard: cached?.standard,
            gloss: cached?.gloss,
            compoundRef: cached?.compoundRef,
          };
        }),
      }));
      onChange(updated);
    },
    [onChange],
  );

  const handleAIResegment = useCallback(
    async (segments: Segment[]): Promise<Segment[] | null> => {
      try {
        const { data, error } = await supabase.functions.invoke("ai-resegment-transcript", {
          body: { segments },
        });
        if (error) throw error;
        const proposed = (data as { segments?: Segment[] } | null)?.segments;
        if (!proposed || proposed.length === 0) {
          toast({
            title: "AI re-segmentation returned no lines",
            description: "Try again or adjust the transcript first.",
            variant: "destructive",
          });
          return null;
        }
        toast({
          title: "AI proposed a new segmentation",
          description: `Review the ${proposed.length} suggested lines and accept or reject.`,
        });
        return proposed;
      } catch (e: any) {
        const msg = e?.message ?? "Unknown error";
        toast({
          title: "AI re-segmentation failed",
          description: msg,
          variant: "destructive",
        });
        return null;
      }
    },
    [],
  );

  return (
    <TranscriptEditor
      initialSegments={initialSegments}
      videoUrl={audioUrl}
      onSave={handleSave}
      onAIResegment={handleAIResegment}
    />
  );
}
