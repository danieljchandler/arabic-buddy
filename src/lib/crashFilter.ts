/**
 * Which unhandled errors are worth calling a crash.
 *
 * `App.tsx` turns every unhandled rejection and window error into a toast, a
 * persisted `__app_last_crash` flag and a row in `client_errors`. That is the
 * right reflex for a real fault, but the browser also rejects promises for
 * things that are not faults at all: a view transition it skipped because the
 * tab was hidden, or aborted because a second navigation landed before the
 * first finished (`TransitionRoutes`), and an `AbortController` a component
 * cancelled on unmount. Every in-app navigation was raising "An unexpected
 * error occurred" for the first of those (QA sweep 2026-09-29, Broken #5/#16),
 * and `/admin/errors` carried dozens of "Transition was aborted" rows from
 * real sessions.
 *
 * The rule: a cancellation is not a crash. Everything else still is.
 */

const BENIGN_NAMES = new Set(["AbortError", "InvalidStateError"]);

const BENIGN_MESSAGES =
  /Transition was (aborted|skipped)|signal is aborted without reason|The operation was aborted/i;

/** True when an unhandled error is a cancellation the app should stay quiet about. */
export function isBenignRejection(reason: unknown): boolean {
  if (reason == null) return false;
  const name = typeof reason === "object" && "name" in reason ? String((reason as { name?: unknown }).name) : "";
  if (BENIGN_NAMES.has(name)) return true;
  const message =
    typeof reason === "string"
      ? reason
      : typeof reason === "object" && "message" in reason
        ? String((reason as { message?: unknown }).message)
        : "";
  return BENIGN_MESSAGES.test(message);
}

/**
 * What to persist across a reload so the recovery toast can say something.
 * `JSON.stringify(new Error("x"))` is `{}`, which is why the sweep's crash
 * flags all carried an empty payload.
 */
export function describeCrash(reason: unknown): { name: string; message: string } {
  if (reason instanceof Error) return { name: reason.name, message: reason.message };
  if (typeof reason === "string") return { name: "Error", message: reason };
  if (reason && typeof reason === "object") {
    const r = reason as { name?: unknown; message?: unknown };
    return {
      name: r.name ? String(r.name) : "Error",
      message: r.message ? String(r.message) : "",
    };
  }
  return { name: "Error", message: reason === undefined ? "" : String(reason) };
}
