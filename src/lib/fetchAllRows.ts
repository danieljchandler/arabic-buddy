/**
 * Read every row of a per-learner table, not just the first thousand.
 *
 * PostgREST caps an unbounded select at 1000 rows and returns the first page
 * with no error and no indication that anything was left behind. For
 * per-learner tables that grow with use — `user_vocabulary`, `word_reviews` —
 * that cap is reached by exactly the learners who use the app most, and the
 * failure is silent: totals under-report, charts flatten, and the numbers get
 * *less* true the more someone studies.
 *
 * Two call sites had already been bitten and fixed this inline (the My Words
 * list, the review deck); this is the same loop, named, so the next query over
 * a growing table can reach for it instead of rediscovering the cap.
 */

/** PostgREST's default ceiling on an unbounded select. */
export const POSTGREST_PAGE = 1000;

/**
 * Page through `build(from, to)` until it returns a short page.
 *
 * `build` receives an inclusive row range and must apply it with `.range()`.
 * A short page means the end of the table; a full page means there may be
 * more, so a table whose length is an exact multiple of the page size costs
 * one extra empty request rather than silently stopping short.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  page = POSTGREST_PAGE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build(from, from + page - 1);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}
