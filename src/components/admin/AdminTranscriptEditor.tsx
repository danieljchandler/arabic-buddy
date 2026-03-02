import { useMemo, useCallback, useRef } from "react";
import type { TranscriptLine, WordToken, Segment, Word } from "@/types/transcript";
import TranscriptEditor from "@/components/TranscriptEditor";

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
  // Store glosses keyed by "segmentId:surface" so they survive round-trips
  const glossMapRef = useRef<Map<string, WordToken>>(new Map());

  // Populate gloss map from incoming lines
  useMemo(() => {
    const map = glossMapRef.current;
    for (const line of lines) {
      for (const token of line.tokens) {
        map.set(`${line.id}:${token.surface}`, token);
      }
    }
  }, [lines]);

  const initialSegments: Segment[] = useMemo(
    () =>
      lines.map((line) => ({
        id: line.id,
        video_id: "",
        start: (line.startMs ?? 0) / 1000,
        end: (line.endMs ?? 0) / 1000,
        text: line.arabic,
        translation: line.translation,
        confidence: 1,
        words: line.tokens.map<Word>((t) => ({
          word: t.surface,
          start: 0,
          end: 0,
          confidence: 1,
        })),
      })),
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
        tokens: seg.words.map<WordToken>((w) => {
          const cached = glossMapRef.current.get(`${seg.id}:${w.word}`);
          return {
            id: cached?.id ?? crypto.randomUUID(),
            surface: w.word,
            standard: cached?.standard,
            gloss: cached?.gloss,
          };
        }),
      }));
      onChange(updated);
    },
    [onChange],
  );

  return (
    <TranscriptEditor
      initialSegments={initialSegments}
      videoUrl={audioUrl}
      onSave={handleSave}
    />
  );
}
