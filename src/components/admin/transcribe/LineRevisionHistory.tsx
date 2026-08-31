import { cn } from "@/lib/utils";
import type { TranscriptRevisionRow } from "@/hooks/useTranscriptReview";

interface LineRevisionHistoryProps {
  revisions: TranscriptRevisionRow[];
  /** Resolve a user id to something a person recognises. */
  nameFor?: (userId: string | null) => string;
  emptyLabel?: string;
}

const FIELD_LABELS: Record<string, string> = {
  arabic: "Arabic",
  translation: "Translation",
  literal: "Literal gloss",
  timing: "Timing",
  structure: "Line added or removed",
  cultural_context: "Cultural notes",
  grammar_points: "Grammar points",
  vocabulary: "Vocabulary",
  dialect: "Dialect",
  dialect_subvariety: "Sub-dialect",
  dialect_features: "Dialect features",
};

const SOURCE_LABELS: Record<TranscriptRevisionRow["source"], string> = {
  human: "edited by hand",
  ai_retranslate: "re-translated by AI",
  ai_resegment: "re-segmented by AI",
  resync: "re-timed against the audio",
};

/** RTL for the Arabic field, LTR for everything else. */
function directionFor(field: string): "rtl" | "ltr" {
  return field === "arabic" ? "rtl" : "ltr";
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * What changed on a line, oldest change at the bottom.
 *
 * Each entry stacks the previous value above the new one rather than putting
 * them side by side. Arabic is right-to-left and English is left-to-right, so a
 * two-column diff of a translation edit puts the two versions at opposite edges
 * of the panel with a gutter between them — readable for code, not for a
 * sentence. Stacked, the two versions start at the same edge and the eye can
 * run straight down.
 */
export function LineRevisionHistory({
  revisions,
  nameFor,
  emptyLabel = "No changes recorded yet.",
}: LineRevisionHistoryProps) {
  if (revisions.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ol className="space-y-3">
      {revisions.map((revision) => {
        const dir = directionFor(revision.field);
        const isAi = revision.source !== "human";

        return (
          <li
            key={revision.id}
            className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-foreground dark:bg-gray-800">
                {FIELD_LABELS[revision.field] ?? revision.field}
              </span>
              <span>{formatWhen(revision.changedAt)}</span>
              {nameFor && <span>· {nameFor(revision.changedBy)}</span>}
              <span
                className={cn(
                  "rounded px-1.5 py-0.5",
                  isAi
                    ? "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200"
                    : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
                )}
              >
                {SOURCE_LABELS[revision.source]}
              </span>
            </div>

            {/* Before, above. */}
            <div className="mb-1.5">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Before
              </p>
              <div
                dir={dir}
                className={cn(
                  "whitespace-pre-wrap rounded border-l-2 border-red-300 bg-red-50/60 px-2 py-1 text-sm dark:border-red-700 dark:bg-red-950/20",
                  dir === "rtl" && "text-right font-cairo",
                )}
              >
                {revision.previousValue ?? (
                  <em className="text-muted-foreground">(nothing — this is new)</em>
                )}
              </div>
            </div>

            {/* After, below. */}
            <div>
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                After
              </p>
              <div
                dir={dir}
                className={cn(
                  "whitespace-pre-wrap rounded border-l-2 border-green-400 bg-green-50/60 px-2 py-1 text-sm dark:border-green-700 dark:bg-green-950/20",
                  dir === "rtl" && "text-right font-cairo",
                )}
              >
                {revision.newValue ?? (
                  <em className="text-muted-foreground">(removed)</em>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default LineRevisionHistory;
