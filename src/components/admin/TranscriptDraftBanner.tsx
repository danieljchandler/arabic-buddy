import { AlertTriangle, CloudOff, History, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDraftTime } from "@/lib/transcriptDraft";
import type { TranscriptDraftState } from "@/hooks/useTranscriptDraft";

interface TranscriptDraftBannerProps {
  draft: TranscriptDraftState;
  /** What the reviewer has to press to publish, named so the banner can say it. */
  publishLabel?: string;
}

/**
 * What the reviewer is told about their unpublished work.
 *
 * The whole point of this strip is one distinction: saved is not published. A
 * transcript that has been auto-saved sits on one person's laptop; a published
 * one is what every learner opening the video reads. Reviewers spend an hour in
 * this editor and will read whatever word is on screen as the state of the
 * world, so the wording never says "saved" on its own, and every state names
 * the button that actually publishes.
 */
export function TranscriptDraftBanner({
  draft,
  publishLabel = "Update Video",
}: TranscriptDraftBannerProps) {
  if (draft.recovered) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-400/60 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-950/30"
      >
        <History className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">
            Unpublished transcript edits from {formatDraftTime(draft.recovered.savedAt)} were
            found on this device
          </p>
          <p className="text-muted-foreground">
            They were never published, so the transcript below is still the stored one. Restoring
            puts the edits back in the editor — they are published only when you press{" "}
            {publishLabel}.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" onClick={draft.restore}>
            Restore edits
          </Button>
          <Button size="sm" variant="ghost" onClick={draft.discardRecovered}>
            Discard
          </Button>
        </div>
      </div>
    );
  }

  if (draft.failed) {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
      >
        <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">This browser would not store a local backup</p>
          <p className="text-muted-foreground">
            Your edits are only in this tab — private browsing and a full storage quota both do
            this. Press {publishLabel} before you leave the page.
          </p>
        </div>
      </div>
    );
  }

  if (!draft.dirty) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-amber-400/60 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-950/30"
    >
      {draft.savedAt === null ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      ) : (
        <PencilLine className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium">Unpublished changes</p>
        <p className="text-muted-foreground">
          {draft.savedAt === null
            ? "Saving a copy to this device…"
            : `Auto-saved to this device at ${formatDraftTime(draft.savedAt)}.`}{" "}
          Learners still see the published transcript until you press {publishLabel}.
        </p>
      </div>
    </div>
  );
}
