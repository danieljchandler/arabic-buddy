import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { shouldResumePipeline, type ResumeCandidate } from "@/lib/pipelineResume";

/**
 * Nudge a stalled transcription run back to life from a page that is polling it.
 *
 * The admin pages already refetch a mid-run video every few seconds. This
 * watches what comes back and, when a row has stopped moving for longer than a
 * live run ever goes quiet (see `shouldResumePipeline`), asks
 * `process-approved-video` to continue from its checkpoint. The function does
 * the deciding: a run that is merely slow is left alone, a finished row is
 * ignored, and a dead one picks up at the stage it reached rather than paying
 * for the engines again.
 *
 * `enabled` should be whether this person may run the pipeline at all —
 * a transcriber's nudge would only be refused.
 */
export function usePipelineResume(
  videos: ResumeCandidate[] | undefined,
  options: { enabled?: boolean } = {},
): void {
  const enabled = options.enabled ?? true;
  const nudgedAt = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!enabled || !videos) return;
    const now = Date.now();
    for (const video of videos) {
      if (!shouldResumePipeline(video, now, nudgedAt.current.get(video.id) ?? null)) continue;
      nudgedAt.current.set(video.id, now);
      supabase.functions
        .invoke("process-approved-video", { body: { videoId: video.id, resume: true } })
        .then(({ data, error }) => {
          if (error) {
            console.warn(`Could not resume transcription for ${video.id}:`, error);
            return;
          }
          // A function that understands `resume` names the stage it picked up
          // at (or says it resumed nothing). One that does not is an older
          // deployment, which reads this request as "start over" — so it
          // must not be sent again, or every nudge becomes a fresh paid run.
          const reply = (data ?? {}) as { stage?: unknown; resumed?: unknown };
          if (reply.stage === undefined && reply.resumed === undefined) {
            console.warn(`process-approved-video did not understand resume for ${video.id}; not asking again`);
            nudgedAt.current.set(video.id, Number.POSITIVE_INFINITY);
          }
        })
        .catch((error: unknown) => {
          console.warn(`Could not resume transcription for ${video.id}:`, error);
        });
    }
  }, [videos, enabled]);
}
