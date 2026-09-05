/**
 * Which build of the edge functions this repository expects to be running.
 *
 * Edge functions do not deploy with the app. On Lovable Cloud the Supabase
 * project is managed for you, so there is no access token to give CI and the
 * deploy stays a separate, manual step — which means the repository and the
 * running backend can disagree, silently, for as long as nobody notices.
 *
 * That is not a hypothetical cost. A transcription bug was chased through
 * three rounds of "still broken" against a backend still serving the previous
 * copy of the fix, and the only thing that eventually settled it was a marker
 * like this one.
 *
 * Both halves import this constant: the deployed function reports it, and the
 * admin app compares what comes back against the value compiled into the
 * frontend it was built from. When they differ, the functions are behind and
 * the app says so, rather than leaving it to be discovered by debugging.
 *
 * **Bump this whenever an edge function changes in a way worth telling apart
 * in production.** The frontend redeploys on merge, so a bumped value there
 * against an unbumped one from the server is exactly the "not deployed yet"
 * signal. Leaving it alone is what makes the check quietly stop working.
 */
export const EDGE_BUILD = "2026-09-05.3";
