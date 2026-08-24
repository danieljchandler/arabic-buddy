import { useEffect } from 'react';
import { shortcutGroups } from '@/lib/transcriptShortcuts';

interface ShortcutHelpProps {
  onClose: () => void;
}

/**
 * The keyboard map, rendered from the same table the resolver reads.
 *
 * Generated rather than written out, so a shortcut cannot exist without being
 * documented or be documented without existing.
 */
export default function ShortcutHelp({ onClose }: ShortcutHelpProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-soft dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Keyboard shortcuts</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-label="Close keyboard shortcuts"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shortcutGroups().map(({ group, items }) => (
          <div key={group}>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group}
            </h4>
            <dl className="space-y-1">
              {items.map((spec) => (
                <div key={`${spec.action}-${spec.keys}`} className="flex items-baseline gap-2">
                  <dt className="flex-shrink-0">
                    <kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] dark:border-gray-600 dark:bg-gray-800">
                      {spec.keys}
                    </kbd>
                  </dt>
                  <dd className="text-xs text-muted-foreground">{spec.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Letter keys work when you are not typing in a box. ⌘ is Ctrl on Windows and Linux.
      </p>
    </div>
  );
}
