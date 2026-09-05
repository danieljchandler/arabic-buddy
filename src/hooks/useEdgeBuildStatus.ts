import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readEdgeBuildStatus, type EdgeBuildStatus } from "@/lib/edgeBuildStatus";

/**
 * Ask the backend which build it is running.
 *
 * One cheap round trip, cached for the session: `process-approved-video`
 * answers `{ probe: true }` before it reads any other argument or touches
 * anything, so this costs a request and nothing else.
 *
 * It stands for the pipeline rather than for all 119 functions — they are
 * deployed together, and this is the one whose staleness has actually bitten.
 * Gate it on the person being able to act on the answer: the probe needs a
 * content manager's session, and telling anyone else that a deploy is overdue
 * is noise they cannot do anything about.
 */
export function useEdgeBuildStatus(options: { enabled?: boolean } = {}) {
  return useQuery<EdgeBuildStatus>({
    queryKey: ["edge-build-status"],
    enabled: options.enabled ?? true,
    // A deploy happens outside this app, so a stale answer is worth avoiding,
    // but not worth a request per mount. Half an hour is well under how long
    // an unnoticed stale backend used to last.
    staleTime: 30 * 60 * 1000,
    // The answer to "is the backend behind" does not change by asking again
    // immediately, and a failed probe is reported as unreachable rather than
    // as a problem with the backend.
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("process-approved-video", {
        body: { probe: true },
      });
      if (error) {
        console.warn("Could not read the deployed edge build:", error);
        return readEdgeBuildStatus(null);
      }
      return readEdgeBuildStatus((data ?? {}) as { build?: unknown });
    },
  });
}
