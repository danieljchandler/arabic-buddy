import { useCallback, useState } from 'react';
import type { Segment } from '@/types/transcript';
import type { ReviewState } from '@/lib/reviewStatus';
import { cn } from '@/lib/utils';
import WordConfidence from './WordConfidence';
import TimestampScrubber from './TimestampScrubber';
import { AskAISentence } from '@/components/shared/AskAISentence';

/**
 * The native-speaker review controls for one line.
 *
 * Bundled into a single optional prop rather than a dozen loose ones because
 * they arrive together or not at all: the video form's editor has no reviewer
 * attached and should render exactly as it always did, while the review
 * workspace supplies the whole set.
 */
export interface SegmentReviewProps {
  state: ReviewState;
  /** ISO timestamp of the sign-off, for the tooltip. */
  reviewedAt?: string;
  /** Comments on this line nobody has closed off. */
  openComments: number;
  /** Logged changes to this line. */
  revisions: number;
  /** True while this line's audio is playing. */
  isPlaying: boolean;
  onToggleReviewed: () => void;
  onOpenComments: () => void;
  onOpenHistory: () => void;
  onPlay: () => void;
  onPlaySlow: () => void;
}

interface SegmentCardProps {
  segment: Segment;
  index: number;
  isActive?: boolean;
  activeWordIndex?: number;
  isStaleTranslation?: boolean;
  prevSegmentEnd?: number;
  nextSegmentStart?: number;
  onSplit: (segmentId: string, splitAfterWordIndex: number) => void;
  onSplitAtCursor: (segmentId: string, cursorPos: number, currentText: string) => void;
  onEditText: (segmentId: string, newText: string) => void;
  onEditTranslation: (segmentId: string, newTranslation: string) => void;
  onStartChange: (segmentId: string, value: number) => void;
  onEndChange: (segmentId: string, value: number) => void;
  onFixArabic?: (segmentId: string) => void;
  onRetranslate?: (segmentId: string) => void;
  onSeek?: (segmentId: string) => void;
  /** Present only in the review workspace. */
  review?: SegmentReviewProps;
}

function confidenceBadgeColor(confidence: number): string {
  if (confidence >= 0.85) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  if (confidence >= 0.65) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
}

/**
 * Renders a single transcript segment with:
 * - RTL Arabic text with per-word confidence coloring
 * - Inline editing via contentEditable
 * - Confidence badge
 * - Timestamp scrubber with ripple support
 * - Split (✂) on word boundary hover
 * - Enter key in edit mode to split at cursor position
 * - AI Fix Arabic and Re-translate buttons
 */
export default function SegmentCard({
  segment,
  index,
  isActive = false,
  activeWordIndex = -1,
  isStaleTranslation = false,
  prevSegmentEnd,
  nextSegmentStart,
  onSplit,
  onSplitAtCursor,
  onEditText,
  onEditTranslation,
  onStartChange,
  onEndChange,
  onFixArabic,
  onRetranslate,
  onSeek,
  review,
}: SegmentCardProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(segment.text);
  const [editingTranslation, setEditingTranslation] = useState(false);
  const [translationValue, setTranslationValue] = useState(segment.translation);
  const [hoveredBoundary, setHoveredBoundary] = useState<number | null>(null);

  const handleWordClick = useCallback(
    (wordIndex: number) => {
      if (editing) return;
      // Enter edit mode. This used to guess at a split by checking whether that
      // boundary happened to be hovered, because the scissors reported itself
      // through this same callback with the same index — which misread a click
      // on a word whose own boundary was under the pointer. WordConfidence now
      // reports the two separately.
      void wordIndex;
      setEditValue(segment.text);
      setEditing(true);
    },
    [editing, segment.text],
  );

  const handleSplitAt = useCallback(
    (wordIndex: number) => {
      if (editing) return;
      onSplit(segment.id, wordIndex);
    },
    [editing, onSplit, segment.id],
  );

  const handleEditDone = useCallback(() => {
    setEditing(false);
    if (editValue.trim() !== segment.text) {
      onEditText(segment.id, editValue.trim());
    }
  }, [editValue, onEditText, segment.id, segment.text]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Plain Enter = split segment at cursor position
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        const cursorPos = e.currentTarget.selectionStart ?? 0;
        const textBefore = editValue.slice(0, cursorPos).trim();
        const textAfter = editValue.slice(cursorPos).trim();
        if (textBefore && textAfter) {
          setEditing(false);
          onSplitAtCursor(segment.id, cursorPos, editValue);
        }
        return;
      }
      // Cmd/Ctrl+Enter to commit edit
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleEditDone();
      }
      // Escape to cancel
      if (e.key === 'Escape') {
        setEditing(false);
        setEditValue(segment.text);
      }
    },
    [handleEditDone, segment.id, segment.text, editValue, onSplitAtCursor],
  );

  return (
    <div
      data-segment-id={segment.id}
      className={cn(
        'rounded-lg border p-3 transition-all',
        // The review state owns the left edge, so a reviewer scrolling a long
        // transcript can see what is still outstanding without reading a word
        // of it. The active-line highlight keeps the rest of the border.
        review?.state === 'reviewed' && 'border-l-4 border-l-green-500',
        review?.state === 'stale' && 'border-l-4 border-l-amber-500',
        review?.state === 'unreviewed' && 'border-l-4 border-l-transparent',
        isActive
          ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 shadow-soft'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300',
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          {review && (
            <button
              type="button"
              role="checkbox"
              aria-checked={review.state === 'reviewed'}
              aria-label={
                review.state === 'reviewed'
                  ? `Line ${index + 1} reviewed — click to un-review`
                  : review.state === 'stale'
                    ? `Line ${index + 1} changed since it was reviewed — click to re-confirm`
                    : `Mark line ${index + 1} as reviewed by a human`
              }
              title={
                review.state === 'stale'
                  ? 'This line changed after it was signed off. Check it again.'
                  : review.state === 'reviewed'
                    ? `Reviewed${review.reviewedAt ? ` ${new Date(review.reviewedAt).toLocaleDateString()}` : ''}`
                    : 'Mark as reviewed by a human'
              }
              onClick={review.onToggleReviewed}
              className={cn(
                'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border text-[11px] font-bold transition-colors',
                review.state === 'reviewed' &&
                  'border-green-600 bg-green-600 text-white hover:bg-green-700',
                review.state === 'stale' &&
                  'border-amber-500 bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200',
                review.state === 'unreviewed' &&
                  'border-gray-300 text-transparent hover:border-green-500 hover:text-green-500 dark:border-gray-600',
              )}
            >
              {review.state === 'stale' ? '!' : '✓'}
            </button>
          )}
          <span className="text-xs text-muted-foreground font-mono">#{index + 1}</span>
          <span
            className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', confidenceBadgeColor(segment.confidence))}
          >
            {(segment.confidence * 100).toFixed(0)}%
          </span>
          {segment.speaker && (
            <span className="text-[10px] text-muted-foreground">{segment.speaker}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {review && (
            <>
              <button
                type="button"
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded transition-colors',
                  review.openComments > 0
                    ? 'bg-sky-100 hover:bg-sky-200 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200'
                    : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700',
                )}
                onClick={review.onOpenComments}
                title="Comments and suggestions on this line"
                aria-label={`Comments on line ${index + 1}${review.openComments > 0 ? ` (${review.openComments} open)` : ''}`}
              >
                💬{review.openComments > 0 ? ` ${review.openComments}` : ''}
              </button>
              {review.revisions > 0 && (
                <button
                  type="button"
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
                  onClick={review.onOpenHistory}
                  title="What changed on this line, and who changed it"
                  aria-label={`History for line ${index + 1} (${review.revisions} changes)`}
                >
                  🕘 {review.revisions}
                </button>
              )}
            </>
          )}
          {segment.text && (
            <AskAISentence
              arabic={segment.text}
              english={segment.translation}
              variant="chip"
              className="h-6 px-2 text-[10px]"
            />
          )}
          {onFixArabic && segment.confidence < 0.85 && (
            <button
              className="text-[10px] px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 transition-colors"
              onClick={() => onFixArabic(segment.id)}
              title="AI Fix Arabic"
            >
              Fix Arabic
            </button>
          )}
          {/* In review mode this is always offered: the reviewer has just
              corrected the Arabic and needs the English to catch up, and
              waiting for the staleness heuristic to agree would hide the
              button exactly when they reach for it. */}
          {onRetranslate && (isStaleTranslation || review) && (
            <button
              className="text-[10px] px-2 py-0.5 rounded bg-purple-100 hover:bg-purple-200 text-purple-800 transition-colors dark:bg-purple-900/40 dark:text-purple-200"
              onClick={() => onRetranslate(segment.id)}
              title="Re-translate"
              aria-label={`Re-translate line ${index + 1} from its current Arabic`}
            >
              Re-translate
            </button>
          )}
          {review && (
            <>
              <button
                type="button"
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded transition-colors',
                  review.isPlaying
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700',
                )}
                onClick={review.onPlay}
                title="Play just this line (Space)"
                aria-label={`Play line ${index + 1}`}
              >
                ▶
              </button>
              <button
                type="button"
                className="text-[10px] px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
                onClick={review.onPlaySlow}
                title="Play this line slowly (Shift+Space)"
                aria-label={`Play line ${index + 1} slowly`}
              >
                🐢
              </button>
            </>
          )}
          <button
            className="text-[10px] px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
            onClick={() => onSeek?.(segment.id)}
            title="Seek video to this segment"
            aria-label={`Seek video to line ${index + 1}`}
          >
            ⇥
          </button>
        </div>
      </div>

      {/* Arabic text (RTL) */}
      {editing ? (
        <div>
          <textarea
            dir="rtl"
            className="w-full text-right font-cairo text-base rounded border border-blue-400 p-1.5 bg-white dark:bg-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={handleEditDone}
            onKeyDown={handleKeyDown}
            rows={2}
            autoFocus
          />
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Enter — split here &nbsp;·&nbsp; ⌘Enter — save &nbsp;·&nbsp; Esc — cancel
          </p>
        </div>
      ) : (
        <div className="min-h-[2em]">
          <WordConfidence
            words={segment.words}
            activeWordIndex={activeWordIndex}
            onWordClick={handleWordClick}
            onSplitAt={handleSplitAt}
            onWordBoundaryHover={setHoveredBoundary}
            hoveredBoundary={hoveredBoundary}
          />
        </div>
      )}

      {/* Translation (click to edit) */}
      <div className="mt-1 text-sm text-muted-foreground flex items-start gap-1">
        {isStaleTranslation && (
          <span className="inline-block w-2 h-2 mt-1.5 rounded-full bg-amber-500 flex-shrink-0" title="Translation may be stale" />
        )}
        {editingTranslation ? (
          <textarea
            dir="ltr"
            className="flex-1 text-left text-sm rounded border border-blue-400 p-1.5 bg-white dark:bg-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-foreground"
            value={translationValue}
            onChange={e => setTranslationValue(e.target.value)}
            onBlur={() => {
              setEditingTranslation(false);
              const next = translationValue.trim();
              if (next !== (segment.translation ?? '')) {
                onEditTranslation(segment.id, next);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setTranslationValue(segment.translation);
                setEditingTranslation(false);
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                (e.currentTarget as HTMLTextAreaElement).blur();
              }
            }}
            rows={2}
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="flex-1 text-left cursor-text hover:bg-muted/40 rounded px-1 py-0.5 -mx-1 transition-colors"
            onClick={() => {
              setTranslationValue(segment.translation ?? '');
              setEditingTranslation(true);
            }}
            title="Click to edit translation"
          >
            {segment.translation || <em aria-label="Missing translation">(no translation — click to add)</em>}
          </button>
        )}
      </div>

      {/* Timestamp scrubber with ripple enabled */}
      <TimestampScrubber
        start={segment.start}
        end={segment.end}
        minStart={prevSegmentEnd ?? 0}
        maxEnd={nextSegmentStart}
        allowRipple
        onStartChange={v => onStartChange(segment.id, v)}
        onEndChange={v => onEndChange(segment.id, v)}
      />
    </div>
  );
}
