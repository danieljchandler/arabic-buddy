import { toast } from "sonner";
import { classifyQueryError } from "./queryErrors";

/**
 * One toast, not one per query, when the backend stops answering.
 *
 * Wired into the QueryClient's QueryCache so pages that have not adopted
 * QueryErrorState still say *something* during an outage. A page can fire a
 * dozen queries at once, so the notice is rate-limited to one per window and
 * only for the kinds a user can act on (network, server); a 401 is handled
 * by the page or the auth flow, and a 4xx is the page's own bug to show.
 */
const WINDOW_MS = 30_000;
let lastShownAt = 0;

export function notifyQueryFailure(error: unknown, now: number = Date.now()): boolean {
  const kind = classifyQueryError(error);
  if (kind !== "network" && kind !== "server") return false;
  if (now - lastShownAt < WINDOW_MS) return false;
  lastShownAt = now;
  toast.error(
    kind === "network" ? "You're offline, or the server can't be reached" : "The server had a problem answering",
    { description: "Some parts of this page may be missing. Pull to refresh or try again in a moment.", id: "query-failure" },
  );
  return true;
}

/** Test seam: forget the last notice so the next failure shows again. */
export function resetQueryFailureNotice() {
  lastShownAt = 0;
}
