import type { Segment } from '@/types/transcript';

interface DiffPreviewProps {
  original: Segment[];
  suggested: Segment[];
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onAcceptOne: (index: number) => void;
  onRejectOne: (index: number) => void;
}

/**
 * Shows a diff between original and AI-suggested segment boundaries.
 * Green = new boundaries, Red = removed boundaries.
 */
export default function DiffPreview({
  original,
  suggested,
  onAcceptAll,
  onRejectAll,
  onAcceptOne,
  onRejectOne,
}: DiffPreviewProps) {
  // Build a set of boundary times for comparison
  const origBoundaries = new Set(original.map(s => `${s.start}-${s.end}`));
  const sugBoundaries = new Set(suggested.map(s => `${s.start}-${s.end}`));

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">AI Suggested Boundaries</h3>
        <div className="flex gap-2">
          <button
            className="px-3 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
            onClick={onAcceptAll}
          >
            Accept All
          </button>
          <button
            className="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
            onClick={onRejectAll}
          >
            Reject All
          </button>
        </div>
      </div>

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {suggested.map((seg, i) => {
          const key = `${seg.start}-${seg.end}`;
          const isNew = !origBoundaries.has(key);

          return (
            <div
              key={`${key}-${i}`}
              dir="rtl"
              className={`flex items-start gap-2 rounded p-2 text-sm ${
                isNew
                  ? 'bg-green-50 dark:bg-green-900/20 border-l-2 border-green-500'
                  : 'bg-gray-50 dark:bg-gray-800/50'
              }`}
            >
              <div className="flex-1 text-right font-cairo">
                <span className="text-muted-foreground text-xs font-mono ltr:inline-block" dir="ltr">
                  {seg.start.toFixed(1)}s – {seg.end.toFixed(1)}s
                </span>
                <p className="mt-0.5">{seg.text}</p>
              </div>
              {isNew && (
                <div className="flex flex-col gap-1" dir="ltr">
                  <button
                    className="text-xs px-2 py-0.5 rounded bg-green-100 hover:bg-green-200 text-green-800 transition-colors"
                    onClick={() => onAcceptOne(i)}
                  >
                    ✓
                  </button>
                  <button
                    className="text-xs px-2 py-0.5 rounded bg-red-100 hover:bg-red-200 text-red-800 transition-colors"
                    onClick={() => onRejectOne(i)}
                  >
                    ✗
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Show removed boundaries */}
        {original
          .filter(s => !sugBoundaries.has(`${s.start}-${s.end}`))
          .map((seg, i) => (
            <div
              key={`removed-${i}`}
              dir="rtl"
              className="flex items-start gap-2 rounded p-2 text-sm bg-red-50 dark:bg-red-900/20 border-l-2 border-red-500 opacity-60 line-through"
            >
              <div className="flex-1 text-right font-cairo">
                <span className="text-muted-foreground text-xs font-mono ltr:inline-block" dir="ltr">
                  {seg.start.toFixed(1)}s – {seg.end.toFixed(1)}s
                </span>
                <p className="mt-0.5">{seg.text}</p>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
