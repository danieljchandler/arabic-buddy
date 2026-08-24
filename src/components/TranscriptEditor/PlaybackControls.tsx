import { cn } from '@/lib/utils';
import { PLAYBACK_RATES } from '@/hooks/useLinePlayback';

interface PlaybackControlsProps {
  rate: number;
  loop: boolean;
  isPlaying: boolean;
  onRateChange: (rate: number) => void;
  onLoopChange: (loop: boolean) => void;
  onStop: () => void;
  onShowHelp: () => void;
}

/**
 * Speed and loop, for listening to one line at a time.
 *
 * This bar is about the reviewer's ears and nothing else: the speed set here
 * applies to line playback in the editor and is never written to the video, so
 * a reviewer who works at 0.65× is not deciding how anyone else will watch it.
 * The label says so, because "did I just change the video?" is the obvious
 * worry on seeing a speed control next to a player.
 */
export default function PlaybackControls({
  rate,
  loop,
  isPlaying,
  onRateChange,
  onLoopChange,
  onStop,
  onShowHelp,
}: PlaybackControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Listen at</span>
        <div className="flex overflow-hidden rounded border border-gray-300 dark:border-gray-600">
          {PLAYBACK_RATES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={rate === option}
              onClick={() => onRateChange(option)}
              className={cn(
                'px-2 py-0.5 text-xs tabular-nums transition-colors',
                rate === option
                  ? 'bg-blue-600 text-white'
                  : 'bg-white hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700',
              )}
            >
              {option}×
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        aria-pressed={loop}
        onClick={() => onLoopChange(!loop)}
        title="Keep repeating the line until you stop it (L)"
        className={cn(
          'rounded border px-2 py-0.5 text-xs transition-colors',
          loop
            ? 'border-blue-600 bg-blue-600 text-white'
            : 'border-gray-300 bg-white hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700',
        )}
      >
        ⟳ Loop
      </button>

      {isPlaying && (
        <button
          type="button"
          onClick={onStop}
          className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs transition-colors hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700"
        >
          ■ Stop
        </button>
      )}

      <span className="text-[11px] text-muted-foreground">
        Affects your playback here only — not the published video.
      </span>

      <button
        type="button"
        onClick={onShowHelp}
        className="ml-auto rounded border border-gray-300 bg-white px-2 py-0.5 text-xs transition-colors hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700"
        title="Keyboard shortcuts (?)"
      >
        ⌨ Shortcuts
      </button>
    </div>
  );
}
