import { useCallback, useEffect, useRef, useState } from 'react';
import type { Segment } from '@/types/transcript';
import { useTranscriptEditor } from '@/hooks/useTranscriptEditor';
import { useVideoSync } from '@/hooks/useVideoSync';
import { useAIAssist } from '@/hooks/useAIAssist';
import SegmentList from './SegmentList';
import Toolbar from './Toolbar';
import DiffPreview from './DiffPreview';

interface TranscriptEditorProps {
  /** Initial segments to edit. */
  initialSegments: Segment[];
  /** Optional video URL for the left-column player. */
  videoUrl?: string;
  /** Called (debounced) whenever segments change. */
  onSave?: (segments: Segment[]) => void;
  /** External API call adapter for AI features. */
  aiApiCall?: (prompt: string, signal: AbortSignal) => Promise<string>;
}

/**
 * Main Transcript Editor — two-column layout:
 * - Left: video player
 * - Right: segment list + toolbar
 * (Stacks vertically on mobile)
 */
export default function TranscriptEditor({
  initialSegments,
  videoUrl,
  onSave,
  aiApiCall,
}: TranscriptEditorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const {
    segments,
    staleTranslations,
    split,
    merge,
    editText,
    shiftTimestamp,
    aiReplace,
    replaceAll,
    handleUndo,
    handleRedo,
    canUndo,
    canRedo,
  } = useTranscriptEditor(initialSegments, onSave);

  const { activeSegmentId, activeWordIndex, seekToSegment } = useVideoSync(segments, videoRef);
  const { status: aiStatus, suggestedSegments, suggestBreaks, fixArabic, cancel: cancelAI } = useAIAssist();

  const [showDiff, setShowDiff] = useState(false);

  // Keyboard shortcuts: Cmd+Z / Cmd+Shift+Z, bracket keys for timestamp nudge
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      if (meta && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      }

      // [ ] nudge start ±100ms, { } nudge end ±100ms for active segment
      if (activeSegmentId) {
        const seg = segments.find(s => s.id === activeSegmentId);
        if (!seg) return;

        if (e.key === '[') {
          shiftTimestamp(seg.id, 'start', Math.max(0, seg.start - 0.1));
        }
        if (e.key === ']') {
          shiftTimestamp(seg.id, 'start', seg.start + 0.1);
        }
        if (e.key === '{') {
          shiftTimestamp(seg.id, 'end', Math.max(seg.start + 0.1, seg.end - 0.1));
        }
        if (e.key === '}') {
          shiftTimestamp(seg.id, 'end', seg.end + 0.1);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo, activeSegmentId, segments, shiftTimestamp]);

  const handleSuggestBreaks = useCallback(async () => {
    if (!aiApiCall) return;
    const result = await suggestBreaks(segments, aiApiCall);
    if (result) setShowDiff(true);
  }, [aiApiCall, segments, suggestBreaks]);

  const handleFixArabic = useCallback(
    async (segmentId: string) => {
      if (!aiApiCall) return;
      const idx = segments.findIndex(s => s.id === segmentId);
      if (idx === -1) return;
      const result = await fixArabic(
        segments[idx],
        idx > 0 ? segments[idx - 1] : null,
        idx < segments.length - 1 ? segments[idx + 1] : null,
        aiApiCall,
      );
      if (result) aiReplace(segmentId, result);
    },
    [aiApiCall, segments, fixArabic, aiReplace],
  );

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Toolbar */}
      <Toolbar
        segments={segments}
        canUndo={canUndo}
        canRedo={canRedo}
        aiStatus={aiStatus}
        staleCount={staleTranslations.size}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSuggestBreaks={handleSuggestBreaks}
        onCancelAI={cancelAI}
      />

      {/* AI Diff Preview */}
      {showDiff && suggestedSegments && (
        <DiffPreview
          original={segments}
          suggested={suggestedSegments}
          onAcceptAll={() => {
            replaceAll(suggestedSegments);
            setShowDiff(false);
          }}
          onRejectAll={() => setShowDiff(false)}
          onAcceptOne={() => {
            /* Per-suggestion accept would require more granular diff logic */
          }}
          onRejectOne={() => {
            /* Per-suggestion reject */
          }}
        />
      )}

      {/* Two-column layout */}
      <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0">
        {/* Left: Video player */}
        {videoUrl && (
          <div className="w-full md:w-1/2 flex-shrink-0">
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className="w-full rounded-lg bg-black"
            />
          </div>
        )}

        {/* Right: Segment list */}
        <div className={`flex-1 min-h-0 overflow-hidden ${videoUrl ? '' : 'w-full'}`}>
          <SegmentList
            segments={segments}
            activeSegmentId={activeSegmentId}
            activeWordIndex={activeWordIndex}
            staleTranslations={staleTranslations}
            onSplit={split}
            onMerge={merge}
            onEditText={editText}
            onStartChange={(id, v) => shiftTimestamp(id, 'start', v)}
            onEndChange={(id, v) => shiftTimestamp(id, 'end', v)}
            onFixArabic={handleFixArabic}
            onSeek={seekToSegment}
          />
        </div>
      </div>
    </div>
  );
}
