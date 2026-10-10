/**
 * The quiz ladder, read back from real ratings (quiz Phase 8): how often each
 * step and format is answered right, and where each LADDER_THRESHOLDS value
 * should be. The arithmetic and the reading are src/lib/quizLadderReport.ts,
 * tested there; this is the shell. Read-only: it sends nothing but GETs.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *     npm run quiz:ladder-report -- [--since 2026-11-01] [--target 0.85] [--min 30] [--json]
 *
 * Says little until the live project carries migration
 * 20261010130000_quiz_rating_asked (Phase 8b) and has a month of ratings
 * since (Phase 8c): before that, the log has no question recorded.
 */
import {
  REPORT_USAGE,
  fetchQuizAnswers,
  formatQuizLadderReport,
  parseReportArgs,
  reportQuizLadder,
} from "../src/lib/quizLadderReport";

async function main(): Promise<number> {
  const parsed = parseReportArgs(process.argv.slice(2));
  if ("help" in parsed) {
    console.log(REPORT_USAGE);
    return 0;
  }
  if ("error" in parsed) {
    console.error(`${parsed.error}\n\n${REPORT_USAGE}`);
    return 2;
  }
  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(`not configured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both needed\n\n${REPORT_USAGE}`);
    return 2;
  }
  // https, or a local stack. The key is sent to this host.
  if (!/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$)/.test(supabaseUrl)) {
    console.error(`SUPABASE_URL must be an https url (or a local stack), got ${supabaseUrl}`);
    return 2;
  }

  const rows = await fetchQuizAnswers({ supabaseUrl, serviceRoleKey, fetch: (url, init) => fetch(url, init), since: parsed.since });
  const report = reportQuizLadder(rows, { target: parsed.target, minAnswers: parsed.minAnswers });
  console.log(parsed.json ? JSON.stringify(report, null, 2) : formatQuizLadderReport(report));
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
