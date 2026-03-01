import type { Word } from '@/types/transcript';
import { cn } from '@/lib/utils';

interface WordConfidenceProps {
  words: Word[];
  activeWordIndex?: number;
  onWordClick?: (index: number) => void;
  onWordBoundaryHover?: (index: number | null) => void;
  hoveredBoundary?: number | null;
}

/** Colour class based on confidence threshold. */
function confidenceColor(confidence: number): string {
  if (confidence >= 0.85) return 'text-green-700 dark:text-green-400';
  if (confidence >= 0.65) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

/**
 * Renders words with per-word confidence coloring and active-word highlighting.
 * Shows a ✂ split icon on hover between word boundaries.
 */
export default function WordConfidence({
  words,
  activeWordIndex = -1,
  onWordClick,
  onWordBoundaryHover,
  hoveredBoundary,
}: WordConfidenceProps) {
  return (
    <span dir="rtl" className="inline text-right font-cairo leading-relaxed">
      {words.map((w, i) => (
        <span key={`${w.start}-${i}`} className="relative inline">
          <span
            role="button"
            tabIndex={0}
            className={cn(
              'cursor-pointer rounded px-0.5 transition-colors',
              confidenceColor(w.confidence),
              activeWordIndex === i && 'bg-blue-200 dark:bg-blue-800',
            )}
            onClick={() => onWordClick?.(i)}
            onKeyDown={e => e.key === 'Enter' && onWordClick?.(i)}
          >
            {w.word}
          </span>
          {/* Split boundary indicator — show between words, not after the last */}
          {i < words.length - 1 && (
            <span
              className="relative mx-0.5 inline-block w-0 align-middle"
              onMouseEnter={() => onWordBoundaryHover?.(i)}
              onMouseLeave={() => onWordBoundaryHover?.(null)}
            >
              {hoveredBoundary === i && (
                <button
                  className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs text-gray-500 hover:text-red-500 transition-colors"
                  title="Split here"
                  onClick={e => {
                    e.stopPropagation();
                    onWordClick?.(i);
                  }}
                >
                  ✂
                </button>
              )}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}
