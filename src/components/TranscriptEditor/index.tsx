import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Segment } from '@/types/transcript';
import type { ReviewState } from '@/lib/reviewStatus';
import { useTranscriptEditor } from '@/hooks/useTranscriptEditor';
import { useVideoSync } from '@/hooks/useVideoSync';
import { useAIAssist } from '@/hooks/useAIAssist';
import { useLinePlayback } from '@/hooks/useLinePlayback';
import {
  isTextEntry,
  NUDGE_SECONDS,
  resolveShortcut,
  type ShortcutAction,
} from '@/lib/transcriptShortcuts';
import SegmentList from './SegmentList';
import Toolbar from './Toolbar';
import DiffPreview from './DiffPreview';
import PlaybackControls from './PlaybackControls';
import ShortcutHelp from './ShortcutHelp';
import type { SegmentReviewProps } from './SegmentCard';

/**
 * What the review workspace knows about a line and the editor does not.
 *
 * Playback is deliberately absent: this component owns the media element, so it
 * fills in `onPlay`/`isPlaying` itself rather than making every caller thread a
 * ref through.
 */
export interface LineReviewSlot {
  state: ReviewState;
  reviewedAt?: string;
  /** The pipeline's own doubt about this line, from `needs_review`. */
  flagged?: boolean;
  flagReason?: string;
  openComments: number;
  revisions: number;
  onToggleReviewed: () => void;
  onOpenComments: () => void;
  onOpenHistory: () => void;
}

interface TranscriptEditorProps {
  /** Initial segments to edit. */
  initialSegments: Segment[];
  /** Optional video URL for the left-column player. */
  videoUrl?: string;
  /** Called (debounced) whenever segments change. */
  onSave?: (segments: Segment[]) => void;
  /** External API call adapter for AI features. */
  aiApiCall?: (prompt: string, signal: AbortSignal) => Promise<string>;
  /**
   * Optional handler that asks an LLM to re-segment the entire transcript
   * into thought-by-thought lines (with speaker change detection). Returns
   * the proposed Segment[] (shown in the diff preview for admin approval)
   * or null if cancelled / failed.
   */
  onAIResegment?: (segments: Segment[]) => Promise<Segment[] | null>;
  /**
   * Optional handler that re-times the current lines against the audio via
   * forced alignment. Returns the re-timed Segment[] (shown in the same diff
   * preview as re-segmentation) or null if cancelled / failed.
   */
  onResyncTiming?: (segments: Segment[]) => Promise<Segment[] | null>;
  /**
   * Re-translate one line from the Arabic it now holds. Offered on every line
   * in review mode, and on stale ones otherwise.
   */
  onRetranslate?: (segmentId: string) => void;
  /**
   * Per-line review state. Supplying it turns on the reviewer's chrome — the
   * checkmarks, the comment and history buttons, the per-line audio controls
   * and the keyboard shortcuts that drive them. Omitting it leaves the editor
   * exactly as the video form has always used it.
   */
  lineReview?: (segmentId: string) => LineReviewSlot | undefined;
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
  onAIResegment,
  onResyncTiming,
  onRetranslate,
  lineReview,
}: TranscriptEditorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reviewMode = Boolean(lineReview);

  const {
    segments,
    staleTranslations,
    split,
    merge,
    editText,
    editTranslation,
    shiftTimestamp,
    shiftTimestampRipple,
    splitAtCursor,
    aiReplace,
    replaceAll,
    handleUndo,
    handleRedo,
    canUndo,
    canRedo,
  } = useTranscriptEditor(initialSegments, onSave);

  const { activeSegmentId, activeWordIndex, seekToSegment } = useVideoSync(segments, videoRef);
  const { status: aiStatus, suggestedSegments, suggestBreaks, fixArabic, cancel: cancelAI } = useAIAssist();
  const playback = useLinePlayback(videoRef);
  const [resegmentLoading, setResegmentLoading] = useState(false);
  const [resegmentSuggestion, setResegmentSuggestion] = useState<Segment[] | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  /**
   * The line the keyboard is pointed at.
   *
   * Separate from `activeSegmentId`, which follows the playhead. Tying the two
   * together would mean that playing a line moved the cursor off whatever the
   * reviewer was working on — and playing the line you are working on is the
   * single most common thing they do.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIndex = useMemo(
    () => segments.findIndex((s) => s.id === selectedId),
    [segments, selectedId],
  );

  // Land on the first line so the shortcuts have somewhere to start, and
  // recover if the selected line is split, merged or deleted away.
  useEffect(() => {
    if (segments.length === 0) return;
    if (selectedId && segments.some((s) => s.id === selectedId)) return;
    setSelectedId(segments[0].id);
  }, [segments, selectedId]);

  const playSegment = useCallback(
    (segment: Segment, slow: boolean) => {
      const span = { id: segment.id, start: segment.start, end: segment.end };
      if (slow) playback.playLineSlow(span);
      else playback.playLine(span);
    },
    [playback],
  );

  const handleRetranslate = useCallback(
    (segmentId: string) => {
      // Flush before asking. The server re-translates the Arabic it has stored,
      // and the correction that prompted the reviewer to press this is usually
      // seconds old — still inside the 800 ms save debounce. Without this, the
      // one flow the button exists for translates the words they just replaced.
      onSave?.(segments);
      onRetranslate?.(segmentId);
    },
    [onRetranslate, onSave, segments],
  );

  // Keyboard shortcuts. The map itself lives in lib/transcriptShortcuts so the
  // help panel is generated from the same table the resolver reads.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const editing = isTextEntry(e.target);
      const action = resolveShortcut(e, { editing });
      if (!action) return;

      const claim = () => e.preventDefault();

      // Outside the workspace only the shortcuts this editor already had apply,
      // so the admin video form behaves exactly as it did before review mode
      // existed — in particular a bare `m` there is still just the letter m.
      const ALWAYS_ON: ShortcutAction[] = [
        'undo',
        'redo',
        'nudge-start-earlier',
        'nudge-start-later',
        'nudge-end-earlier',
        'nudge-end-later',
      ];
      if (!reviewMode && !ALWAYS_ON.includes(action)) return;

      const segment = selectedIndex >= 0 ? segments[selectedIndex] : undefined;
      // The timing nudges predate selection and follow the playhead, which is
      // what the video form's users are used to.
      const timingTarget = reviewMode
        ? segment
        : segments.find((s) => s.id === activeSegmentId);

      switch (action) {
        case 'undo':
          claim();
          handleUndo();
          return;
        case 'redo':
          claim();
          handleRedo();
          return;
        case 'nudge-start-earlier':
          if (!timingTarget) return;
          shiftTimestampRipple(timingTarget.id, 'start', Math.max(0, timingTarget.start - NUDGE_SECONDS));
          return;
        case 'nudge-start-later':
          if (!timingTarget) return;
          shiftTimestampRipple(timingTarget.id, 'start', timingTarget.start + NUDGE_SECONDS);
          return;
        case 'nudge-end-earlier':
          if (!timingTarget) return;
          shiftTimestampRipple(
            timingTarget.id,
            'end',
            Math.max(timingTarget.start + NUDGE_SECONDS, timingTarget.end - NUDGE_SECONDS),
          );
          return;
        case 'nudge-end-later':
          if (!timingTarget) return;
          shiftTimestampRipple(timingTarget.id, 'end', timingTarget.end + NUDGE_SECONDS);
          return;
      }

      if (!reviewMode) return;

      switch (action) {
        case 'next-line':
          claim();
          if (selectedIndex < segments.length - 1) setSelectedId(segments[selectedIndex + 1].id);
          break;
        case 'prev-line':
          claim();
          if (selectedIndex > 0) setSelectedId(segments[selectedIndex - 1].id);
          break;
        case 'play-line':
          claim();
          if (segment) {
            // A second press stops, so Space is a toggle rather than a restart.
            if (playback.playingLineId === segment.id) playback.stop();
            else playSegment(segment, false);
          }
          break;
        case 'play-line-slow':
          claim();
          if (segment) playSegment(segment, true);
          break;
        case 'toggle-loop':
          claim();
          playback.setLoop(!playback.loop);
          break;
        case 'edit-line':
          claim();
          if (segment) {
            const card = document.querySelector<HTMLElement>(
              `[data-segment-id="${segment.id}"] [data-edit-arabic]`,
            );
            card?.click();
          }
          break;
        case 'merge-next':
          claim();
          if (selectedIndex >= 0 && selectedIndex < segments.length - 1) merge(selectedIndex);
          break;
        case 'merge-prev':
          claim();
          if (selectedIndex > 0) {
            merge(selectedIndex - 1);
            setSelectedId(segments[selectedIndex - 1].id);
          }
          break;
        case 'toggle-reviewed':
          claim();
          if (segment) lineReview?.(segment.id)?.onToggleReviewed();
          break;
        case 'retranslate':
          claim();
          if (segment) handleRetranslate(segment.id);
          break;
        case 'comment':
          claim();
          if (segment) lineReview?.(segment.id)?.onOpenComments();
          break;
        case 'help':
          claim();
          setShowHelp((open) => !open);
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    activeSegmentId,
    handleRedo,
    handleRetranslate,
    handleUndo,
    lineReview,
    merge,
    playSegment,
    playback,
    reviewMode,
    segments,
    selectedIndex,
    shiftTimestampRipple,
  ]);

  const handleSuggestBreaks = useCallback(async () => {
    if (!aiApiCall) return;
    const result = await suggestBreaks(segments, aiApiCall);
    if (result) setShowDiff(true);
  }, [aiApiCall, segments, suggestBreaks]);

  const handleAIResegment = useCallback(async () => {
    if (!onAIResegment || resegmentLoading) return;
    setResegmentLoading(true);
    setResegmentSuggestion(null);
    try {
      const result = await onAIResegment(segments);
      if (result && result.length > 0) {
        setResegmentSuggestion(result);
        setShowDiff(true);
      }
    } finally {
      setResegmentLoading(false);
    }
  }, [onAIResegment, resegmentLoading, segments]);

  // Same accept/reject flow as re-segmentation — a re-timed transcript is a
  // proposal too, and the diff preview is what earns it the reviewer's trust.
  const handleResyncTiming = useCallback(async () => {
    if (!onResyncTiming || resegmentLoading) return;
    setResegmentLoading(true);
    setResegmentSuggestion(null);
    try {
      const result = await onResyncTiming(segments);
      if (result && result.length > 0) {
        setResegmentSuggestion(result);
        setShowDiff(true);
      }
    } finally {
      setResegmentLoading(false);
    }
  }, [onResyncTiming, resegmentLoading, segments]);

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

  /** Merge the workspace's per-line state with the playback this component owns. */
  const reviewFor = useCallback(
    (segmentId: string): SegmentReviewProps | undefined => {
      const slot = lineReview?.(segmentId);
      if (!slot) return undefined;
      const segment = segments.find((s) => s.id === segmentId);
      return {
        ...slot,
        isPlaying: playback.playingLineId === segmentId,
        onPlay: () => segment && playSegment(segment, false),
        onPlaySlow: () => segment && playSegment(segment, true),
      };
    },
    [lineReview, playSegment, playback.playingLineId, segments],
  );

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Toolbar */}
      <Toolbar
        segments={segments}
        canUndo={canUndo}
        canRedo={canRedo}
        aiStatus={resegmentLoading ? 'loading' : aiStatus}
        staleCount={staleTranslations.size}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSuggestBreaks={handleSuggestBreaks}
        onAIResegment={onAIResegment ? handleAIResegment : undefined}
        onResyncTiming={onResyncTiming ? handleResyncTiming : undefined}
        onCancelAI={cancelAI}
        onShowShortcuts={() => setShowHelp((open) => !open)}
      />

      {reviewMode && (
        <PlaybackControls
          rate={playback.rate}
          loop={playback.loop}
          isPlaying={playback.playingLineId !== null}
          onRateChange={playback.setRate}
          onLoopChange={playback.setLoop}
          onStop={playback.stop}
        />
      )}

      {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} />}

      {/* AI Diff Preview — prefer the resegment suggestion when present */}
      {showDiff && (resegmentSuggestion ?? suggestedSegments) && (
        <DiffPreview
          original={segments}
          suggested={(resegmentSuggestion ?? suggestedSegments)!}
          onAcceptAll={() => {
            replaceAll((resegmentSuggestion ?? suggestedSegments)!);
            setShowDiff(false);
            setResegmentSuggestion(null);
          }}
          onRejectAll={() => {
            setShowDiff(false);
            setResegmentSuggestion(null);
          }}
          onAcceptOne={(index) => {
            const list = (resegmentSuggestion ?? suggestedSegments)!;
            const suggested = list[index];
            if (suggested) {
              replaceAll([
                ...segments.filter(s => s.start < suggested.start),
                suggested,
                ...segments.filter(s => s.start >= suggested.end),
              ]);
            }
          }}
          onRejectOne={() => {
            // Individual reject is a no-op — suggestion stays in diff but isn't applied
          }}
          onKeepOne={(index) => {
            // Put one original boundary back into the proposal, so Accept All
            // stops merging it away. Previously a removed line had no controls
            // at all and the only way to save one was Reject All — throwing out
            // nineteen good changes to keep one boundary.
            const list = (resegmentSuggestion ?? suggestedSegments)!;
            const kept = segments[index];
            if (!kept) return;
            // Timings are floats built by summing word durations, so a tolerance
            // rather than an exact comparison.
            const EPSILON = 1e-6;
            const overlapsKept = (s: Segment) =>
              s.start < kept.end - EPSILON && kept.start < s.end - EPSILON;
            setResegmentSuggestion(
              [...list.filter((s) => !overlapsKept(s)), kept].sort((a, b) => a.start - b.start),
            );
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
            selectedSegmentId={reviewMode ? selectedId : null}
            onSelect={reviewMode ? setSelectedId : undefined}
            reviewFor={reviewMode ? reviewFor : undefined}
            onSplit={split}
            onSplitAtCursor={splitAtCursor}
            onMerge={merge}
            onEditText={editText}
            onEditTranslation={editTranslation}
            onStartChange={(id, v) => shiftTimestampRipple(id, 'start', v)}
            onEndChange={(id, v) => shiftTimestampRipple(id, 'end', v)}
            onFixArabic={handleFixArabic}
            onRetranslate={onRetranslate ? handleRetranslate : undefined}
            onSeek={seekToSegment}
          />
        </div>
      </div>
    </div>
  );
}
