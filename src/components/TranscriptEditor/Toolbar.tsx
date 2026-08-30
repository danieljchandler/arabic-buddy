import { useState } from 'react';
import type { Segment, GapWarning, PublishCheckItem } from '@/types/transcript';
import { analyseGaps, runPublishChecklist } from '@/lib/gapAnalysis';
import { toSRT } from '@/lib/srtExport';

interface ToolbarProps {
  segments: Segment[];
  canUndo: boolean;
  canRedo: boolean;
  aiStatus?: 'idle' | 'loading' | 'error';
  staleCount: number;
  onUndo: () => void;
  onRedo: () => void;
  onSuggestBreaks?: () => void;
  onAIResegment?: () => void;
  onResyncTiming?: () => void;
  onRetranslateAllStale?: () => void;
  onCancelAI?: () => void;
  /** Open the editor's keyboard-shortcut panel. Hides the button when absent. */
  onShowShortcuts?: () => void;
}

/**
 * Toolbar for the transcript editor.
 * Contains: Undo/Redo, AI actions, SRT export, publish checklist.
 */
export default function Toolbar({
  segments,
  canUndo,
  canRedo,
  aiStatus = 'idle',
  staleCount,
  onUndo,
  onRedo,
  onSuggestBreaks,
  onAIResegment,
  onResyncTiming,
  onRetranslateAllStale,
  onCancelAI,
  onShowShortcuts,
}: ToolbarProps) {
  const [showChecklist, setShowChecklist] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);

  const warnings: GapWarning[] = analyseGaps(segments);
  const checklist: PublishCheckItem[] = runPublishChecklist(segments);
  const errors = warnings.filter(w => w.severity === 'error');

  const handleExportSRT = () => {
    const srt = toSRT(segments);
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcript.srt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2 bg-gray-50 dark:bg-gray-900">
      {/* Undo / Redo */}
      <button
        className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 disabled:opacity-40 transition-colors"
        disabled={!canUndo}
        onClick={onUndo}
        title="Undo (Cmd+Z)"
      >
        ↩ Undo
      </button>
      <button
        className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 disabled:opacity-40 transition-colors"
        disabled={!canRedo}
        onClick={onRedo}
        title="Redo (Cmd+Shift+Z)"
      >
        ↪ Redo
      </button>

      <span className="w-px h-5 bg-gray-300 dark:bg-gray-600" />

      {/* AI actions */}
      {aiStatus === 'loading' ? (
        <div className="flex items-center gap-1">
          <span className="text-xs text-blue-600 animate-pulse">AI rethinking timing…</span>
          <button
            className="px-2 py-1 text-xs rounded bg-red-100 hover:bg-red-200 text-red-700 transition-colors"
            onClick={onCancelAI}
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          {onAIResegment && (
            <button
              className="px-2 py-1 text-xs rounded bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-600 hover:to-purple-600 transition-colors font-medium"
              onClick={onAIResegment}
              title="AI: Re-segment transcript into thought-by-thought lines, splitting on speaker changes"
            >
              ✨ AI Re-segment
            </button>
          )}
          {onResyncTiming && (
            <button
              className="px-2 py-1 text-xs rounded bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600 transition-colors font-medium"
              onClick={onResyncTiming}
              title="Align every line and word to the audio by forced alignment — the text stays exactly as written"
            >
              🎯 Re-sync timing
            </button>
          )}
          {onSuggestBreaks && (
            <button
              className="px-2 py-1 text-xs rounded bg-blue-100 hover:bg-blue-200 text-blue-800 transition-colors"
              onClick={onSuggestBreaks}
              title="AI: Suggest natural sentence breaks"
            >
              🤖 Suggest Breaks
            </button>
          )}
          {staleCount > 0 && (
            <button
              className="px-2 py-1 text-xs rounded bg-purple-100 hover:bg-purple-200 text-purple-800 transition-colors"
              onClick={onRetranslateAllStale}
            >
              Re-translate stale ({staleCount})
            </button>
          )}
        </>
      )}

      <span className="w-px h-5 bg-gray-300 dark:bg-gray-600" />

      {/* Warnings */}
      <button
        className={`px-2 py-1 text-xs rounded transition-colors ${
          errors.length > 0
            ? 'bg-red-100 text-red-800 hover:bg-red-200'
            : warnings.length > 0
              ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
              : 'bg-green-100 text-green-800 hover:bg-green-200'
        }`}
        onClick={() => setShowWarnings(!showWarnings)}
      >
        {errors.length > 0
          ? `⚠ ${errors.length} error${errors.length > 1 ? 's' : ''}`
          : warnings.length > 0
            ? `${warnings.length} warning${warnings.length > 1 ? 's' : ''}`
            : '✓ Clean'}
      </button>

      {/* Export */}
      <button
        className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 disabled:opacity-40 transition-colors"
        onClick={handleExportSRT}
        disabled={errors.length > 0}
        title={errors.length > 0 ? 'Fix errors before exporting' : 'Export SRT'}
      >
        📥 Export SRT
      </button>

      {/* Publish checklist */}
      <button
        className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 transition-colors"
        onClick={() => setShowChecklist(!showChecklist)}
      >
        📋 Checklist
      </button>

      {/* Keyboard shortcuts. The panel itself is the editor's, not the
          toolbar's: `?` opens the same one, and two copies of the key map is
          how a shortcut ends up documented in one of them and not the other. */}
      {onShowShortcuts && (
        <button
          className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 transition-colors"
          onClick={onShowShortcuts}
          title="Keyboard shortcuts"
        >
          ⌨ Shortcuts
        </button>
      )}

      {/* Warning details dropdown */}
      {showWarnings && warnings.length > 0 && (
        <div className="basis-full mt-1 rounded border border-gray-200 dark:border-gray-700 p-2 text-xs space-y-1">
          {warnings.map((w, i) => (
            <div
              key={i}
              className={`px-2 py-1 rounded ${w.severity === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}
            >
              {w.message}
            </div>
          ))}
        </div>
      )}

      {/* Checklist dropdown */}
      {showChecklist && (
        <div className="basis-full mt-1 rounded border border-gray-200 dark:border-gray-700 p-2 text-xs space-y-1">
          {checklist.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={item.passed ? 'text-green-600' : 'text-red-600'}>
                {item.passed ? '✓' : '✗'}
              </span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
