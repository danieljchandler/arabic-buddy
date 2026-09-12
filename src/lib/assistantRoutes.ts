/**
 * Where the Ask AI assistant is switched off, and why.
 *
 * Two surfaces answer this question — the floating disc (AskAiFab) and the
 * Cmd/Ctrl+K opener (AssistantMount) — and they used to answer it with two
 * hand-copied lists. That is exactly the shape of bug this file exists to
 * stop: a route added to one list and not the other gives a page a button
 * that opens nothing, or a keystroke that opens a tutor over a sign-in form.
 *
 * The reason is stored next to the prefix rather than in a comment because
 * `src/test/askAiCoverage.test.ts` reads this list and holds every learner
 * route in the manifest to it: a route is either assistant-enabled, or it is
 * named here with a written reason. "Nobody got round to it" is not one of
 * the reasons, which is the point — the default is on.
 */
export const ASSISTANT_OFF_ROUTES: ReadonlyArray<readonly [prefix: string, reason: string]> = [
  ["/auth", "the sign-in form — there is no learner yet, and nothing on the page to ask about"],
  ["/login/id", "the ID sign-in form, same as /auth"],
  ["/reset-password", "arrived at from an email link; a password form is not a lesson"],
  [
    "/onboarding",
    "a guided first run that asks its own questions — a second assistant on top of it competes with the flow",
  ],
  ["/admin", "the staff console; the tutor is a learner-facing feature and has no context for it"],
] as const;

/** True when the assistant (disc, shortcut and panel) is switched off here. */
export function isAssistantOffRoute(pathname: string): boolean {
  return ASSISTANT_OFF_ROUTES.some(
    ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
