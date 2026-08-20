import { describe, expect, it, vi } from "vitest";
import { fetchAllRows, POSTGREST_PAGE } from "./fetchAllRows";

/**
 * The loop that stops a growing table from silently truncating at PostgREST's
 * 1000-row ceiling — the failure mode where the app gets less accurate the
 * more someone uses it.
 */

/** A fake table of `n` rows that honours the requested range. */
const table = (n: number) => {
  const rows = Array.from({ length: n }, (_, i) => ({ i }));
  return vi.fn(async (from: number, to: number) => ({
    data: rows.slice(from, to + 1),
    error: null,
  }));
};

describe("fetchAllRows", () => {
  it("returns a short table in one request", async () => {
    const build = table(3);
    expect(await fetchAllRows(build)).toHaveLength(3);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("keeps going past the page ceiling", async () => {
    // The whole point: an unbounded select would have stopped at 1000 and
    // reported the result as complete.
    const build = table(POSTGREST_PAGE + 250);
    expect(await fetchAllRows(build)).toHaveLength(POSTGREST_PAGE + 250);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("asks once more when the last page came back exactly full", async () => {
    // A full page is indistinguishable from "there is more", so stopping on
    // it would drop every row of a table whose size is a page multiple.
    const build = table(POSTGREST_PAGE * 2);
    expect(await fetchAllRows(build)).toHaveLength(POSTGREST_PAGE * 2);
    expect(build).toHaveBeenCalledTimes(3);
  });

  it("requests inclusive ranges, as .range() expects", async () => {
    const build = table(POSTGREST_PAGE + 1);
    await fetchAllRows(build);
    expect(build.mock.calls[0]).toEqual([0, POSTGREST_PAGE - 1]);
    expect(build.mock.calls[1]).toEqual([POSTGREST_PAGE, POSTGREST_PAGE * 2 - 1]);
  });

  it("throws rather than returning a partial read", async () => {
    const build = vi.fn(async () => ({ data: null, error: new Error("nope") }));
    await expect(fetchAllRows(build)).rejects.toThrow("nope");
  });

  it("treats a null payload as the end", async () => {
    const build = vi.fn(async () => ({ data: null, error: null }));
    expect(await fetchAllRows(build)).toEqual([]);
  });
});
