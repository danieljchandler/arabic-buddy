import { useEffect, useRef } from 'react';
import type { Segment } from '@/types/transcript';
import SegmentCard from './SegmentCard';

interface SegmentListProps {
  segments: Segment[];
  activeSegmentId?: string | null;
  activeWordIndex?: number;
  staleTranslations: Set<string>;
  onSplit: (segmentId: string, splitAfterWordIndex: number) => void;
  onMerge: (index: number) => void;
  onEditText: (segmentId: string, newText: string) => void;
  onStartChange: (segmentId: string, value: number) => void;
  onEndChange: (segmentId: string, value: number) => void;
  onFixArabic?: (segmentId: string) => void;
  onRetranslate?: (segmentId: string) => void;
  onSeek?: (segmentId: string) => void;
}

/**
 * Scrollable list of SegmentCards with merge buttons between segments.
 * Active segment auto-scrolls into view.
 */
export default function SegmentList({
  segments,
  activeSegmentId,
  activeWordIndex,
  staleTranslations,
  onSplit,
  onMerge,
  onEditText,
  onStartChange,
  onEndChange,
  onFixArabic,
  onRetranslate,
  onSeek,
}: SegmentListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll active segment into view
  useEffect(() => {
    if (!activeSegmentId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-segment-id="${activeSegmentId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeSegmentId]);

  return (
    <div ref={listRef} className="space-y-1 overflow-y-auto">
      {segments.map((seg, i) => (
        <div key={seg.id}>
          <SegmentCard
            segment={seg}
            index={i}
            isActive={seg.id === activeSegmentId}
            activeWordIndex={seg.id === activeSegmentId ? activeWordIndex : -1}
            isStaleTranslation={staleTranslations.has(seg.id)}
            prevSegmentEnd={i > 0 ? segments[i - 1].end : undefined}
            nextSegmentStart={i < segments.length - 1 ? segments[i + 1].start : undefined}
            onSplit={onSplit}
            onEditText={onEditText}
            onStartChange={onStartChange}
            onEndChange={onEndChange}
            onFixArabic={onFixArabic}
            onRetranslate={onRetranslate}
            onSeek={onSeek}
          />

          {/* Merge button between segments */}
          {i < segments.length - 1 && (
            <div className="flex justify-center py-0.5 group">
              <button
                className="text-[10px] px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 transition-opacity"
                onClick={() => onMerge(i)}
                title={`Merge segments ${i + 1} and ${i + 2}`}
              >
                ⤵ Merge
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
