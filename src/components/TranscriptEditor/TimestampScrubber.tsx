import { useCallback, useRef, useEffect, useState } from 'react';

interface TimestampScrubberProps {
  start: number;
  end: number;
  /** Minimum allowed start (e.g. previous segment's end). */
  minStart?: number;
  /** Maximum allowed end (e.g. next segment's start). */
  maxEnd?: number;
  onStartChange: (value: number) => void;
  onEndChange: (value: number) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

/**
 * Thin horizontal scrubber bar with draggable left/right handles
 * for adjusting segment start/end timestamps.
 */
export default function TimestampScrubber({
  start,
  end,
  minStart = 0,
  maxEnd = Infinity,
  onStartChange,
  onEndChange,
}: TimestampScrubberProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const [dragLabel, setDragLabel] = useState<string | null>(null);

  const totalRange = Math.max(maxEnd === Infinity ? end + 5 : maxEnd, end + 1) - Math.min(minStart, start);
  const offset = Math.min(minStart, start);

  const pxToTime = useCallback(
    (clientX: number) => {
      if (!barRef.current) return start;
      const rect = barRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return offset + ratio * totalRange;
    },
    [offset, totalRange, start],
  );

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: MouseEvent) => {
      const t = pxToTime(e.clientX);
      if (dragging === 'start') {
        const clamped = Math.max(minStart, Math.min(t, end - 0.1));
        onStartChange(Math.round(clamped * 1000) / 1000);
        setDragLabel(formatTime(clamped));
      } else {
        const clamped = Math.min(maxEnd === Infinity ? t : maxEnd, Math.max(t, start + 0.1));
        onEndChange(Math.round(clamped * 1000) / 1000);
        setDragLabel(formatTime(clamped));
      }
    };

    const onUp = () => {
      setDragging(null);
      setDragLabel(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, pxToTime, start, end, minStart, maxEnd, onStartChange, onEndChange]);

  const startPct = ((start - offset) / totalRange) * 100;
  const endPct = ((end - offset) / totalRange) * 100;

  return (
    <div className="relative mt-1 select-none">
      {/* Time labels */}
      <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5 font-mono">
        <span>{formatTime(start)}</span>
        {dragLabel && <span className="text-blue-600 font-semibold">{dragLabel}</span>}
        <span>{formatTime(end)}</span>
      </div>

      {/* Bar */}
      <div ref={barRef} className="relative h-2 rounded bg-gray-200 dark:bg-gray-700">
        {/* Active range */}
        <div
          className="absolute top-0 h-full rounded bg-blue-400/50"
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
        />

        {/* Left handle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-4 rounded-sm bg-blue-600 cursor-ew-resize hover:bg-blue-700 transition-colors"
          style={{ left: `calc(${startPct}% - 6px)` }}
          onMouseDown={e => {
            e.preventDefault();
            setDragging('start');
          }}
        />

        {/* Right handle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-4 rounded-sm bg-blue-600 cursor-ew-resize hover:bg-blue-700 transition-colors"
          style={{ left: `calc(${endPct}% - 6px)` }}
          onMouseDown={e => {
            e.preventDefault();
            setDragging('end');
          }}
        />
      </div>
    </div>
  );
}
