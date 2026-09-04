/**
 * What a failed query means, and whether asking again could help.
 *
 * Every list page used to fold a failed fetch into "no rows", so an outage
 * rendered as an empty state ("No videos", "No lessons yet") with nothing to
 * retry — the 2026-09-04 audit's M3. These helpers give React Query a retry
 * policy that never re-asks a 4xx and give `QueryErrorState` one vocabulary
 * for the three things that can actually be wrong: the network, the session,
 * or the server.
 *
 * Error shapes seen in this app:
 *   - `TypeError("Failed to fetch")` and friends — the request never got an
 *     answer (offline, DNS, a reset tunnel).
 *   - `FunctionsHttpError` from `supabase.functions.invoke` — carries the
 *     `Response` as `context`, so its status is known.
 *   - `PostgrestError` from `.from()` — no status, but a `code`: `42501` is
 *     permission denied, `PGRST301`/`PGRST302` are JWT problems, `57014` is a
 *     statement timeout.
 *   - `AuthError` from supabase-js — has a numeric `status`.
 */

export type QueryErrorKind = "network" | "auth" | "server" | "client";

const NETWORK_MESSAGE = /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_(connection|internet|network)|timed? ?out/i;
const AUTH_CODES = new Set(["42501", "PGRST301", "PGRST302", "PGRST303"]);

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { status?: unknown; context?: unknown; statusCode?: unknown };
  const ctx = e.context as { status?: unknown } | undefined;
  for (const candidate of [ctx?.status, e.status, e.statusCode]) {
    if (typeof candidate === "number" && candidate >= 100 && candidate < 600) return candidate;
  }
  return null;
}

function codeOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message ?? "";
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return typeof error === "string" ? error : "";
}

/** The HTTP status a query failure carries, when the error shape has one. */
export function httpStatusOf(error: unknown): number | null {
  return statusOf(error);
}

export function classifyQueryError(error: unknown): QueryErrorKind {
  const status = statusOf(error);
  if (status === 401 || status === 403) return "auth";
  if (status !== null) return status >= 500 ? "server" : "client";

  const code = codeOf(error);
  if (code && AUTH_CODES.has(code)) return "auth";
  if (code === "57014") return "server";

  const message = messageOf(error);
  if (error instanceof TypeError || NETWORK_MESSAGE.test(message)) return "network";
  if (/\bjwt\b|\bunauthori[sz]ed\b|\b401\b|token (has )?expired|invalid token/i.test(message)) return "auth";
  return "server";
}

/**
 * React Query `retry` policy. One more try for anything that might be
 * transient (network, 5xx); none for a 4xx, whose answer will not change —
 * re-asking a 401 four times was what the crawl saw on every public page.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  const kind = classifyQueryError(error);
  return kind === "network" || kind === "server";
}

export interface QueryErrorCopy {
  title: string;
  description: string;
  action: string;
}

/** The same three messages ErrorBoundary uses for render-time errors. */
export const QUERY_ERROR_COPY: Record<QueryErrorKind, QueryErrorCopy> = {
  network: {
    title: "Connection problem",
    description: "We couldn't reach the server. Check your internet connection and try again.",
    action: "Try again",
  },
  auth: {
    title: "Your session expired",
    description: "Please sign in again to continue.",
    action: "Sign in",
  },
  server: {
    title: "Something went wrong",
    description: "The server had a problem answering. It is usually brief — try again in a moment.",
    action: "Try again",
  },
  client: {
    title: "Something went wrong",
    description: "This request was refused. Reloading the page usually fixes it.",
    action: "Try again",
  },
};

export function describeQueryError(error: unknown): QueryErrorCopy & { kind: QueryErrorKind } {
  const kind = classifyQueryError(error);
  return { kind, ...QUERY_ERROR_COPY[kind] };
}
